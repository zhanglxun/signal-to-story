/**
 * Generate the field-by-field schema audit page from the repo migrations.
 *
 *   npm run audit:schema            → docs/review/db-schema-audit.html
 *
 * The page is self-contained (no network). Review marks live in the browser's localStorage and
 * are exported as JSON / Markdown; regenerating the page keeps them because keys are table.column.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { REPO_ROOT } from "../pglite-harness"
import { collectAuditData } from "./catalog"

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(REPO_ROOT, "docs/review/db-schema-audit.html")

const data = await collectAuditData()
if (data.missing.length) {
  console.error("schema-audit notes are incomplete:\n- " + data.missing.join("\n- "))
  process.exit(1)
}

const css = readFileSync(path.join(here, "page.css"), "utf8")
const js = readFileSync(path.join(here, "page.js"), "utf8")
const json = JSON.stringify(data).replace(/</g, "\\u003c")

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="data:," />
<title>数据库字段审计台</title>
<style>${css}</style>
</head>
<body>
<header>
  <div class="eyebrow">SIGNAL TO STORY · SCHEMA AUDIT</div>
  <h1>星火工厂 · 数据库字段审计台</h1>
  <p class="notice">
    <b>第 2 轮（MVP 精简版）。</b>表名下蓝色框是对你第 1 轮意见的答复；划线的字段是 MVP 要删除的，红色标签写了它的去向；表末紫色字段是 MVP 新增的。完整说明见 docs/database.md 第 2～7 节和 9.1。<br />
    <b>逐字段确认。</b>每个字段标「可以 / 要改 / 有疑问」，要改或有疑问的请在备注里写清楚；表级意见写在表名下面的备注框。
    类型、键、约束都是从仓库全部迁移在 PGlite 上实际建库后读出来的，不是手抄；只有「用途说明」是人写的。
    标「退役 / 不上线」的表不必逐字段看：表名下点「确认移除」，整张表就收起，字段计为已审；点「要保留」再写明保留哪些字段。<br />
    标 <span class="badge draft">草案</span> 的是 DB2～DB5 计划新建的表或新增的字段，还没写进迁移，类型以审计结论为准。
  </p>
  <p class="meta" id="meta"></p>
</header>
<main>
  <div class="toolbar">
    <span id="count"></span>
    <input id="search" type="search" placeholder="搜表名 / 字段 / 说明" />
    <select id="filter">
      <option value="all">全部字段</option>
      <option value="todo">只看未审</option>
      <option value="change">只看要改</option>
      <option value="ask">只看有疑问</option>
      <option value="noted">只看有备注</option>
    </select>
    <label><input id="hide-retired" type="checkbox" /> 隐藏退役 / 不上线</label>
    <button id="export-json">导出审计 JSON</button>
    <button id="export-md">导出审计结果 .md</button>
    <label class="file">导入 JSON<input id="import" type="file" accept="application/json" /></label>
    <button id="reset">清空</button>
  </div>
  <nav id="toc"></nav>
  <div id="list"></div>
  <p class="foot">审计标记保存在本浏览器的 localStorage（键 <code>sts-schema-audit-v1</code>），重新生成本页不会丢；导出的 JSON 或 .md 交回给我即可按结论改迁移。</p>
</main>
<script type="application/json" id="data">${json}</script>
<script>${js}</script>
</body>
</html>
`

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, html)
const fields = data.categories.flatMap((c) => c.tables).reduce((n, t) => n + t.columns.length, 0)
console.log(`wrote ${path.relative(REPO_ROOT, OUT)}: ${data.categories.flatMap((c) => c.tables).length} tables, ${fields} fields, ${data.migrations.count} migrations`)
