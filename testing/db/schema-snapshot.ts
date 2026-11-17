/**
 * DB0 reconciliation helpers: build a structural snapshot of the database defined by the repo's
 * migrations (on PGlite) and diff it against a snapshot exported from the live project with
 * supabase/snippets/schema_snapshot.sql. Read-only on both sides.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { createSupabaseTestDb, REPO_ROOT } from "./pglite-harness"

export const SNAPSHOT_SQL_PATH = path.join(REPO_ROOT, "supabase/snippets/schema_snapshot.sql")

export interface SchemaSnapshot {
  tables: Record<string, unknown>[]
  columns: Record<string, unknown>[]
  constraints: Record<string, unknown>[]
  indexes: Record<string, unknown>[]
  functions: Record<string, unknown>[]
  triggers: Record<string, unknown>[]
  policies: Record<string, unknown>[]
  grants: Record<string, unknown>[]
  buckets: Record<string, unknown>[]
}

export type SnapshotCategory = keyof SchemaSnapshot

/** Identity key per category; everything else in the row is compared as the "definition". */
const KEYS: Record<SnapshotCategory, string[]> = {
  tables: ["schema", "name"],
  columns: ["schema", "tbl", "name"],
  constraints: ["schema", "tbl", "name"],
  indexes: ["schema", "tbl", "name"],
  functions: ["schema", "name", "args"],
  triggers: ["schema", "tbl", "name"],
  policies: ["schema", "tbl", "name"],
  grants: ["schema", "tbl", "grantee"],
  buckets: ["id"],
}

export const CATEGORIES = Object.keys(KEYS) as SnapshotCategory[]

/** The query without its trailing commented-out second query. */
export function snapshotQuery(): string {
  const sql = readFileSync(SNAPSHOT_SQL_PATH, "utf8")
  return sql.split("-- Second query")[0]
}

/** Snapshot of the schema produced by applying repo migrations up to (and including) `upTo`. */
export async function snapshotRepo(upTo?: string): Promise<{ snapshot: SchemaSnapshot; applied: string[] }> {
  const db = await createSupabaseTestDb({ upTo })
  try {
    const res = await db.asPostgres((tx) => tx.query<{ snapshot: SchemaSnapshot }>(snapshotQuery()))
    return { snapshot: res.rows[0].snapshot, applied: db.appliedMigrations }
  } finally {
    await db.close()
  }
}

/** Accepts the raw jsonb, `{snapshot: …}`, or a SQL-editor export `[{snapshot: …}]` (value may be a JSON string). */
export function parseSnapshotFile(text: string): SchemaSnapshot {
  let value: unknown = JSON.parse(text)
  if (Array.isArray(value)) value = value[0]
  if (value && typeof value === "object" && "snapshot" in value) value = (value as { snapshot: unknown }).snapshot
  if (typeof value === "string") value = JSON.parse(value)
  const snap = value as SchemaSnapshot
  for (const c of CATEGORIES) if (!Array.isArray(snap?.[c])) throw new Error(`snapshot is missing "${c}"`)
  return snap
}

const keyOf = (category: SnapshotCategory, row: Record<string, unknown>) => KEYS[category].map((k) => String(row[k])).join(".")
const definitionOf = (category: SnapshotCategory, row: Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !KEYS[category].includes(k)).sort()))

export interface CategoryDiff {
  onlyRemote: string[]
  onlyRepo: string[]
  changed: { key: string; remote: string; repo: string }[]
}

/**
 * Drop differences that come from the environment rather than from migrations:
 * - NOT NULL rows in pg_constraint (contype 'n', newer Postgres/PGlite only; nullability is compared on columns);
 * - storage triggers that execute storage.* functions (managed by the Supabase platform, not by our migrations);
 * - the `extensions.` schema prefix that pg_get_*def prints depending on search_path.
 */
export function normalizeSnapshot(snap: SchemaSnapshot): SchemaSnapshot {
  const strip = (row: Record<string, unknown>) =>
    typeof row.def === "string" ? { ...row, def: row.def.replace(/\bextensions\./g, "") } : row
  return {
    ...snap,
    constraints: snap.constraints.filter((k) => k.type !== "n").map(strip),
    indexes: snap.indexes.map(strip),
    triggers: snap.triggers
      .filter((t) => !(t.schema === "storage" && /EXECUTE FUNCTION storage\./.test(String(t.def))))
      .map(strip),
    functions: snap.functions.map(strip),
    policies: snap.policies.map(strip),
  }
}

export function diffSnapshots(remoteRaw: SchemaSnapshot, repoRaw: SchemaSnapshot): Record<SnapshotCategory, CategoryDiff> {
  const remote = normalizeSnapshot(remoteRaw)
  const repo = normalizeSnapshot(repoRaw)
  const out = {} as Record<SnapshotCategory, CategoryDiff>
  for (const c of CATEGORIES) {
    const r = new Map(remote[c].map((row) => [keyOf(c, row), definitionOf(c, row)]))
    const l = new Map(repo[c].map((row) => [keyOf(c, row), definitionOf(c, row)]))
    out[c] = {
      onlyRemote: [...r.keys()].filter((k) => !l.has(k)).sort(),
      onlyRepo: [...l.keys()].filter((k) => !r.has(k)).sort(),
      changed: [...r.keys()].filter((k) => l.has(k) && r.get(k) !== l.get(k)).sort().map((key) => ({ key, remote: r.get(key)!, repo: l.get(key)! })),
    }
  }
  return out
}

export function renderDiffMarkdown(diff: Record<SnapshotCategory, CategoryDiff>, meta: { upTo: string; applied: number }): string {
  const lines = [`# DB0 schema diff`, ``, `Repo side: ${meta.applied} migrations up to \`${meta.upTo}\`.`, ``,
    `| category | only live | only repo | changed |`, `| --- | ---: | ---: | ---: |`]
  for (const c of CATEGORIES) lines.push(`| ${c} | ${diff[c].onlyRemote.length} | ${diff[c].onlyRepo.length} | ${diff[c].changed.length} |`)
  for (const c of CATEGORIES) {
    const d = diff[c]
    if (!d.onlyRemote.length && !d.onlyRepo.length && !d.changed.length) continue
    lines.push(``, `## ${c}`)
    if (d.onlyRemote.length) lines.push(``, `Only live:`, ...d.onlyRemote.map((k) => `- \`${k}\``))
    if (d.onlyRepo.length) lines.push(``, `Only repo:`, ...d.onlyRepo.map((k) => `- \`${k}\``))
    if (d.changed.length) lines.push(``, `Changed:`, ...d.changed.flatMap((x) => [`- \`${x.key}\``, `  - live: \`${x.remote}\``, `  - repo: \`${x.repo}\``]))
  }
  return lines.join("\n") + "\n"
}
