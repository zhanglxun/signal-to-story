# 数据库测试

两种形式，覆盖同一套迁移：

| 形式 | 位置 | 运行方式 |
| --- | --- | --- |
| SQL 验收脚本（`begin … rollback`，失败即 `assert`） | `supabase/tests/*.sql` | 本地/测试 Supabase：`psql -f`；或在 vitest 中经 PGlite 执行 |
| vitest + PGlite 真实 RLS/RPC 测试 | `src/test/db/*.test.ts`、`workers/agent/*.test.ts` | `npm run test`（无需 docker / supabase CLI / psql） |

## PGlite harness

`src/test/db/pglite-harness.ts` 在进程内启动 WASM Postgres，先执行 `src/test/db/supabase-shim.sql`，再按文件名顺序应用 `supabase/migrations/*.sql` 全部迁移。

```ts
// @vitest-environment node            ← 必须：PGlite 需要 node 环境
import { createSupabaseTestDb, seedOrganization, runSqlAcceptanceScript } from "./pglite-harness"

const db = await createSupabaseTestDb()                 // 约 1 秒；建议每个文件 beforeAll 一次
const org = await seedOrganization(db, { members: [{ role: "owner" }, { role: "viewer" }] })

await db.asUser(org.members.owner, (tx) => tx.query("select * from public.agent_jobs"))   // role authenticated + JWT sub
await db.asServiceRole((tx) => tx.query("select * from public.claim_agent_job($1,$2,$3)", ["w1", ["content_draft"], 60]))
await db.asAnon((tx) => tx.query("select 1"))
await db.asPostgres((tx) => tx.query("update ..."))     // 超级用户，造数据/模拟时间流逝
await runSqlAcceptanceScript(db, "agent_harness_kernel.sql")
await db.close()
```

- 每个 `as*()` 是一个事务：`set local role …` + `request.jwt.claims`（与 PostgREST 每请求的行为一致），回调抛错即回滚。
- `seedOrganization` 为每个角色建一个 auth 用户、profile、组织角色（可传 `permissions` 覆盖）和成员关系。
- `createSupabaseTestDb({ upTo: "20261006141445_intake_remote_oauth.sql" })` 只应用到某个迁移，便于测试升级迁移。
- 新增迁移不需要改 harness；若用到新的 Supabase 内置对象（如新的 extension、`vault`、`pgmq`），在 `supabase-shim.sql` 里补最小垫片，**不要改历史迁移**。

### 垫片内容（`supabase-shim.sql`）

- 角色：`anon`、`authenticated`、`service_role`（`bypassrls`，与 Supabase 一致）。
- `auth.users`（常用列）、`auth.uid()` / `auth.role()` / `auth.jwt()` / `auth.email()`，同时兼容旧的 `request.jwt.claim.sub` 与新的 `request.jwt.claims`。
- `storage.buckets`、`storage.objects`（启用 RLS）、`storage.foldername()`。
- `extensions` schema + `pgcrypto`（`gen_random_bytes`）+ `pg_trgm`（PGlite contrib 扩展）。
- Supabase 的 `alter default privileges in schema public grant all … to anon, authenticated, service_role`，保证 `revoke`/`grant` 语义与线上一致。

截至 P1.5，所有 18 个迁移均**无需任何针对单个迁移的垫片**即可在 PGlite 中应用。

### 已知局限

- PGlite 是单连接，并发事务会被串行化：`FOR UPDATE SKIP LOCKED` 的“不重复认领”在逻辑上被验证（并发 `Promise.all` 认领无重复），但没有真实锁竞争。
- 不模拟 GoTrue、PostgREST、Realtime、Storage API、Edge Functions。调用路径上的 Data API 行为（例如 PostgREST 只暴露 `public`、不能调用 `set_config`）需要在真实 Supabase 上另行验证。
