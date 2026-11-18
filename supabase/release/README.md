# 上线脚本与执行手册

这里放的是**从迁移文件生成**的上线脚本，不要手改。改了迁移就重新生成：

```bash
npx tsx testing/db/release.ts          # 生成 supabase/release/0.5.0-step1.sql
npx vitest run testing/db/release.test.ts   # 在模拟线上状态的 PGlite 上演练
```

背景见 [docs/database.md](../../docs/database.md) 第 8 节和 DB-D14：线上库同时作为开发、测试和正式环境，迁移分批推送。

---

## 0.5.0 第 1 批（DB2a + DB2b）

**做什么**：在一个事务里完成以下几步，任何一步失败都会整体回滚，数据库保持原样。

1. 前置检查：迁移历史最后一条必须是 `20261030023526`；0.5 的表还不存在；线上旧 `site_*` 表必须为空。
2. 删除线上旧读者站对象：10 张空的 `site_*` 表，函数 `ensure_site_settings`、`publish_site_entry`、`unpublish_site_entry`、`is_verified_reader`、`site_entries_guard_release_fields`、`ingest_harvested_signals`。
3. 按顺序执行 12 个迁移（`20261115090000` ～ `20261122100000`）。
4. 写入迁移历史（`supabase_migrations.schema_migrations`），以后 `supabase db push` 不会重复执行这些迁移。
5. 把 V1 数据复制到新表：`private.backfill_v1()` 把信源、选题、内容项目复制成收件箱输入和事项，把审核记录复制到审计表，并输出各类行数。V1 旧表**不删**，留到最后的退役批次。

**不做什么**：不删除任何有数据的表，不改已有数据，脚本里没有密钥。

### 给 Codex 的执行步骤

> 执行人：Codex。需要项目的数据库连接，或 Supabase Dashboard 的 SQL Editor 权限。**不要在输出或日志里打印任何密钥、连接串或项目 ID。**

1. **备份**（必须先做）
   - 有 Supabase CLI 和数据库连接串时：`supabase db dump --data-only -f backup-0.5.0-step1-data.sql`，以及 `supabase db dump -f backup-0.5.0-step1-schema.sql`。
   - 或者在 Dashboard → Database → Backups 确认当天有可用的备份。
   - 备份文件放在仓库外，不要提交。

2. **只读预检**：在 SQL Editor 执行下面这段，结果应为 `20261030023526`、`null`、`0`：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;
   select to_regclass('public.work_items');
   select (select count(*) from public.site_settings) + (select count(*) from public.site_entries);
   ```

   结果不一致就**停止**，把结果发回来。

3. **执行脚本**：二选一。
   - SQL Editor：打开 `supabase/release/0.5.0-step1.sql`，**整份粘贴、一次运行**。
   - psql：`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/release/0.5.0-step1.sql`。

   出现任何报错都说明已经整体回滚，**不要分段重跑**，把报错原文发回来。

4. **核对结果**：

   ```sql
   select version, name from supabase_migrations.schema_migrations order by version desc limit 12;   -- 12 行，最新是 20261122100000
   select count(*) as inputs from public.intake_events;      -- 约等于线上信源数（2026-11-16 为 33）
   select count(*) as items from public.work_items;          -- 选题数 + 已整理但没有选题的信源 + 没合并进选题的内容项目
   select count(*) from public.content_documents where work_item_id is null;   -- 应为 0
   select to_regclass('public.site_release_sources');        -- 应为 null（旧表已删）
   ```

   把这些结果和第 3 步 `backfill_v1:` 那行通知原样发回来。

5. **部署 Edge Functions**（代码已改，接口与旧版兼容）：

   ```bash
   supabase functions deploy intake-gateway im-webhook content-draft
   ```

6. **不需要做的**：不要执行 `supabase db push`，不要修改函数的环境变量，也不要动线上已部署的控制台。本地控制台和 worker 使用 0.5.0 分支的代码即可。

### 执行后

- 本地控制台（`npm --prefix sense-console run dev`，`.env.local` 指向线上库）可以验证收件箱、事项列表和详情页。
- 线上已部署的 V1 控制台多数页面还能用，但「速记」现在会进收件箱，不再生成选题。等 0.5 控制台部署后统一更新。
- **出问题怎么回退**：脚本失败会自动回滚，不需要处理。脚本已经成功但想撤销时，只能用第 1 步的备份恢复。
