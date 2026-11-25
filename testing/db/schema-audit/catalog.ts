/**
 * Read the real public schema (after every repo migration, on PGlite) and merge it with notes.ts
 * into the data the audit page renders. Read-only; no network.
 */
import { createSupabaseTestDb } from "../pglite-harness"
import {
  CATEGORIES,
  COLUMN_PLANS,
  COMMON,
  LIVE_ROWS,
  PLANNED_COLUMNS,
  PLANNED_TABLES,
  TABLES,
  type Fate,
} from "./notes"

interface RawColumn { tbl: string; kind: string; col: string; typ: string; nn: boolean; def: string | null; ident: string; gen: string }
interface RawConstraint { tbl: string; name: string; type: string; def: string; cols: string[] | null }
interface RawIndex { tbl: string; name: string; def: string; uniq: boolean; pk: boolean; constraint: boolean; cols: string[] | null }
interface RawTrigger { tbl: string; name: string; def: string }
interface RawPolicy { tbl: string; name: string; cmd: string; roles: string; qual: string | null; check: string | null }
interface RawTable { tbl: string; kind: string; rls: boolean; options: string[] | null }

export interface AuditColumn {
  name: string
  type: string
  keys: string[]
  notes: string[]
  meaning: string
  plan?: string
  draft?: boolean
}

export interface AuditTable {
  name: string
  kind: "table" | "view"
  purpose: string
  fate: Fate
  fateNote?: string
  reply?: string
  live: boolean
  liveRows?: number
  draft: boolean
  columns: AuditColumn[]
  extras: { label: string; items: string[] }[]
}

export interface AuditData {
  generatedAt: string
  migrations: { count: number; last: string }
  categories: { key: string; title: string; intro: string; tables: AuditTable[] }[]
  missing: string[]
}

/** Make pg_get_*def output shorter without changing its meaning. */
export function tidy(sql: string): string {
  return sql
    .replace(/::(text|numeric|jsonb|interval|integer|bigint|smallint|text\[\])/g, "")
    .replace(/\bpublic\./g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** `(x = ANY (ARRAY['a', 'b']))` → `取值：a / b`; otherwise the tidied check body. */
export function describeCheck(def: string): string {
  const body = tidy(def).replace(/^CHECK\s*/, "")
  const values = body.match(/^\(+\(?"?\w+"?\)? = ANY \(ARRAY\[(.+)\]\)\)+$/)
  if (values) return "取值：" + [...values[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).join(" / ")
  const nullOrValues = body.match(/IS NULL\) OR \(\w+ = ANY \(ARRAY\[(.+)\]\)\)/)
  if (nullOrValues) return "可空；取值：" + [...nullOrValues[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).join(" / ")
  return humanize(body)
}

const unwrap = (s: string) => {
  let x = s.trim()
  while (/^\(.*\)$/.test(x) && balanced(x.slice(1, -1))) x = x.slice(1, -1).trim()
  return x
}
function balanced(s: string): boolean {
  let d = 0
  for (const ch of s) {
    if (ch === "(") d++
    if (ch === ")" && --d < 0) return false
  }
  return d === 0
}

/** Common single-column checks in plain words; anything else stays as SQL. */
export function humanize(body: string): string {
  let x = unwrap(body).replace(/^\(?"?\w+"? IS NULL\)? OR /, "")
  x = unwrap(x)
  const C = '"?\\w+"?'
  const rules: [RegExp, string][] = [
    [new RegExp(`^\\(?char_length\\(btrim\\(${C}\\)\\) >= 1\\)? AND \\(?char_length\\(btrim\\(${C}\\)\\) <= (\\d+)\\)?$`), "去空格后 1–$1 字"],
    [new RegExp(`^\\(?char_length\\(${C}\\) >= (\\d+)\\)? AND \\(?char_length\\(${C}\\) <= (\\d+)\\)?$`), "$1–$2 字"],
    [new RegExp(`^char_length\\(${C}\\) <= (\\d+)$`), "≤ $1 字"],
    [new RegExp(`^\\(?${C} >= \\(?(-?[\\d.]+)\\)?\\)? AND \\(?${C} <= \\(?(-?[\\d.]+)\\)?\\)?$`), "范围 $1–$2"],
    [new RegExp(`^${C} >= \\(?(-?[\\d.]+)\\)?$`), "≥ $1"],
    [new RegExp(`^${C} > \\(?(-?[\\d.]+)\\)?$`), "> $1"],
    [new RegExp(`^jsonb_typeof\\(${C}\\) = '(\\w+)'$`), "JSON $1"],
    [new RegExp(`^\\(?jsonb_typeof\\(${C}\\) = '(\\w+)'\\)? AND \\(?pg_column_size\\(${C}\\) <= (\\d+)\\)?$`), "JSON $1，≤ $2 字节"],
    [new RegExp(`^cardinality\\(${C}\\) <= (\\d+)$`), "最多 $1 个"],
    [new RegExp(`^cardinality\\(${C}\\) > 0$`), "至少 1 个"],
    [new RegExp(`^${C} ~ '(.+)'$`), "格式 $1"],
    [new RegExp(`^${C} = lower\\(btrim\\(${C}\\)\\)$`), "必须小写且无首尾空格"],
  ]
  for (const [re, out] of rules) if (re.test(x)) return x.replace(re, out).replace(/\b(object|array)\b/, (m) => (m === "object" ? "对象" : "数组"))
  return "check " + x
}

function fkLabel(def: string, cols: string[]): string {
  const m = tidy(def).match(/^FOREIGN KEY \(([^)]+)\) REFERENCES ([\w.]+)\(([^)]+)\)(.*)$/)
  if (!m) return tidy(def)
  const [, , target, targetCols, rest] = m
  const on = rest.match(/ON DELETE (CASCADE|SET NULL(?: \([^)]+\))?|RESTRICT|SET DEFAULT)/)?.[1]
  const own = cols.length > 1 ? `FK (${cols.join(", ")})` : "FK"
  const tgt = targetCols === "id" || cols.length > 1 ? target : `${target}(${targetCols})`
  return `${own} → ${tgt}${on ? `，删除时 ${on.toLowerCase()}` : ""}`
}

function indexLabel(ix: RawIndex): string {
  const m = ix.def.match(/USING (\w+) \((.+?)\)( WHERE .+)?$/)
  const using = m && m[1] !== "btree" ? ` ${m[1]}` : ""
  const where = m?.[3] ? ` where ${tidy(m[3].replace(/^ WHERE /, ""))}` : ""
  return `${ix.uniq ? "唯一索引" : "索引"}${using}(${m ? tidy(m[2]) : ix.cols?.join(", ")})${where}`
}

export async function collectAuditData(): Promise<AuditData> {
  const db = await createSupabaseTestDb()
  const q = async <T>(sql: string) => (await db.asPostgres((tx) => tx.query<T>(sql))).rows
  try {
    const tables = await q<RawTable>(`select c.relname tbl, c.relkind kind, c.relrowsecurity rls, c.reloptions options
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v')`)
    const cols = await q<RawColumn>(`select c.relname tbl, c.relkind kind, a.attname col, format_type(a.atttypid, a.atttypmod) typ,
        a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def, a.attidentity ident, a.attgenerated gen
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      where n.nspname = 'public' and c.relkind in ('r','v') order by c.relname, a.attnum`)
    const cons = await q<RawConstraint>(`select c.relname tbl, k.conname name, k.contype type, pg_get_constraintdef(k.oid) def,
        (select array_agg(a.attname order by array_position(k.conkey, a.attnum)) from pg_attribute a where a.attrelid = c.oid and a.attnum = any(k.conkey)) cols
      from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and k.contype in ('p','f','u','c','x') order by c.relname, k.conname`)
    const idx = await q<RawIndex>(`select c.relname tbl, i.relname name, pg_get_indexdef(i.oid) def, x.indisunique uniq, x.indisprimary pk,
        exists (select 1 from pg_constraint k where k.conindid = i.oid) "constraint",
        (select array_agg(a.attname order by array_position(x.indkey::int2[], a.attnum)) from pg_attribute a where a.attrelid = c.oid and a.attnum = any(x.indkey)) cols
      from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class c on c.oid = x.indrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' order by c.relname, i.relname`)
    const trg = await q<RawTrigger>(`select c.relname tbl, t.tgname name, pg_get_triggerdef(t.oid) def
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal order by c.relname, t.tgname`)
    const pol = await q<RawPolicy>(`select tablename tbl, policyname name, cmd, array_to_string(roles, ', ') roles, qual, with_check "check"
      from pg_policies where schemaname = 'public' order by tablename, policyname`)

    const missing: string[] = []
    const byTable = new Map<string, RawColumn[]>()
    for (const c of cols) byTable.set(c.tbl, [...(byTable.get(c.tbl) ?? []), c])
    const placed = new Set(CATEGORIES.flatMap((c) => c.tables))
    for (const t of byTable.keys()) if (!placed.has(t)) missing.push(`表 ${t} 没有放进任何分类`)

    const planned = new Map(PLANNED_TABLES.map((t) => [t.name, t]))

    const buildReal = (name: string): AuditTable => {
      const note = TABLES[name]
      if (!note) missing.push(`表 ${name} 没有说明`)
      const raw = byTable.get(name)!
      const meta = tables.find((t) => t.tbl === name)!
      const tCons = cons.filter((k) => k.tbl === name)
      const tIdx = idx.filter((i) => i.tbl === name)

      const columns: AuditColumn[] = raw.map((c) => {
        const keys: string[] = []
        const notes: string[] = []
        for (const k of tCons) {
          const kc = k.cols ?? []
          if (!kc.includes(c.col)) continue
          const others = kc.filter((x) => x !== "organization_id")
          // Composite keys that include organization_id are shown on their other columns.
          if (c.col === "organization_id" && others.length > 0 && k.type !== "c") continue
          if (k.type === "p") keys.push(kc.length > 1 ? `PK(${kc.join(", ")})` : "PK")
          if (k.type === "f") keys.push(fkLabel(k.def, kc))
          if (k.type === "u") keys.push(kc.length > 1 ? `UQ(${kc.join(", ")})` : "UQ")
          if (k.type === "x") keys.push(`排他约束 ${tidy(k.def)}`)
          if (k.type === "c" && kc.length === 1) notes.push(describeCheck(k.def))
        }
        for (const i of tIdx) {
          if (i.constraint || !i.cols?.length) continue
          // An index led by organization_id is listed on its second column, like composite keys.
          const lead = i.cols[0] === "organization_id" && i.cols.length > 1 ? i.cols[1] : i.cols[0]
          if (lead === c.col) keys.push(indexLabel(i))
        }
        const rank = (k: string) => (k.startsWith("PK") ? 0 : k.startsWith("FK") ? 1 : k.startsWith("UQ") ? 2 : 3)
        keys.sort((a, b) => rank(a) - rank(b))
        if (c.ident) notes.unshift("自增（identity）")
        else if (c.gen === "s") notes.unshift(`生成列：${tidy(c.def ?? "")}`)
        else if (c.def) notes.unshift(`默认 ${tidy(c.def)}`)
        notes.unshift(meta.kind === "v" ? "视图列" : c.nn ? "必填" : "可空")
        const meaning = note?.cols[c.col] ?? COMMON[c.col] ?? ""
        if (!meaning) missing.push(`${name}.${c.col} 没有说明`)
        return { name: c.col, type: c.typ.replace("timestamp with time zone", "timestamptz"), keys, notes, meaning, plan: COLUMN_PLANS[`${name}.${c.col}`] }
      })
      for (const p of PLANNED_COLUMNS[name] ?? []) {
        columns.push({ name: p.name, type: p.type, keys: p.keys ? [p.keys] : [], notes: [p.note].filter(Boolean), meaning: p.meaning, plan: "计划新增", draft: true })
      }

      const extras = [
                { label: "全部约束", items: tCons.map((k) => `${k.name}：${tidy(k.def)}`) },
        { label: "全部索引", items: tIdx.map((i) => `${i.name}：${tidy(i.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, "$1"))}`) },
        { label: "触发器", items: trg.filter((t) => t.tbl === name).map((t) => `${t.name}：${tidy(t.def.replace(/^CREATE (CONSTRAINT )?TRIGGER \S+ /, ""))}`) },
        {
          label: meta.kind === "v" ? "视图选项" : meta.rls ? "RLS 已开启 · 策略" : "RLS 未开启",
          items:
            meta.kind === "v"
              ? (meta.options ?? [])
              : pol.filter((p) => p.tbl === name).map((p) => `${p.name}（${p.cmd} · ${p.roles}）${p.qual ? ` using ${tidy(p.qual)}` : ""}${p.check ? ` check ${tidy(p.check)}` : ""}`),
        },
      ].filter((e) => e.items.length > 0 || e.label === "RLS 未开启")

      return {
        name,
        kind: meta.kind === "v" ? "view" : "table",
        purpose: note?.purpose ?? "",
        fate: note?.fate ?? "保留",
        fateNote: note?.fateNote,
        reply: note?.reply,
        live: name in LIVE_ROWS,
        liveRows: LIVE_ROWS[name],
        draft: false,
        columns,
        extras,
      }
    }

    const categories = CATEGORIES.map((cat) => ({
      key: cat.key,
      title: cat.title,
      intro: cat.intro,
      tables: cat.tables.map((name): AuditTable => {
        if (byTable.has(name)) return buildReal(name)
        const p = planned.get(name)
        if (!p) {
          missing.push(`分类里的 ${name} 既不在迁移里，也不在计划表里`)
          return { name, kind: "table", purpose: "", fate: "新建", live: false, draft: true, columns: [], extras: [] }
        }
        return {
          name,
          kind: p.kind,
          purpose: p.purpose,
          fate: "新建",
          fateNote: p.fateNote,
          reply: p.reply,
          live: false,
          draft: true,
          columns: p.cols.map((c) => ({ name: c.name, type: c.type, keys: c.keys ? [c.keys] : [], notes: [c.note].filter(Boolean), meaning: c.meaning, draft: true })),
          extras: [],
        }
      }),
    }))

    return {
      generatedAt: new Date().toISOString(),
      migrations: { count: db.appliedMigrations.length, last: db.appliedMigrations.at(-1) ?? "" },
      categories,
      missing,
    }
  } finally {
    await db.close()
  }
}
