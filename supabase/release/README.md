# 上线脚本与执行手册

这里放的是**从迁移文件生成**的上线脚本，不要手改。改了迁移就重新生成：

```bash
npx tsx testing/db/release.ts          # 生成 supabase/release/0.5.0-step1.sql、0.5.0-step2.sql
npx vitest run testing/db/release.test.ts testing/db/release-step2.test.ts   # 在模拟线上状态的 PGlite 上演练
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

---

## 0.5.0 第 2 批（DB2c-1：任务表精简）

**做什么**：在一个事务里执行迁移 `20261123100000_agent_jobs_mvp`，任何一步失败都会整体回滚。

1. 前置检查：迁移历史最后一条必须是 `20261122100000`；`agent_jobs.lease_epoch` 还不存在；**没有任何任务持有未过期的租约**（worker 必须先停）。
2. `agent_jobs` 精简到 21 列：`job_type` 改名 `kind`；目标、批准、上限移进 `payload.target` / `payload.approval_request_id` / `payload.limits`；新增 `work_item_id`、`node_id`、`lease_epoch`、`notified_at`。现有行原地搬迁，旧的进度列（轮次、费用、模型等）保存在 `result.legacy_columns`。
3. `agent_job_steps` 精简到 10 列：轮次、评估、输入摘要进 `output`，模型、费用、耗时进 `usage`，按时间编号 `seq`。现有行原地搬迁。
4. `approval_requests` 加 `notified_at`。已有的任务和批准记为「已通知」，不会补发旧通知。
5. 节点的 RPC 换成带 `lease_epoch` 的新签名；删除 `im_notify_target`，改由 `list_pending_notices` / `mark_notice_sent` 轮询通知。
6. 写入迁移历史。

**不做什么**：不删表、不删数据、不需要回填，脚本里没有密钥。审批门禁（发布、付费渲染）仍由数据库触发器执行，强度不变。

### 给 Codex 的执行步骤

> 执行人：Codex。需要项目的数据库连接，或 Supabase Dashboard 的 SQL Editor 权限。**不要在输出或日志里打印任何密钥、连接串或项目 ID。**

1. **停掉所有 worker**（本机的 `npm run worker:agent`、视频 worker 容器），等 2～5 分钟让租约过期。

2. **备份**（必须先做；这一批会原地改写已有任务和步骤的数据，免费版没有自动备份）
   - 有 Supabase CLI 和数据库连接串时：`supabase db dump --data-only -f backup-0.5.0-step2-data.sql`，以及 `supabase db dump -f backup-0.5.0-step2-schema.sql`。
   - 没有 CLI 时：在 Dashboard → Table Editor 把 `agent_jobs`、`agent_job_steps`、`approval_requests` 三张表分别 Export → CSV（行数很少，这一批只改这三张表）。
   - 备份文件放在仓库外，不要提交。

3. **只读预检**：结果应为 `20261122100000`、`0`、`0`，并记下最后两行的数字：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;
   select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'agent_jobs' and column_name = 'lease_epoch';
   select count(*) from public.agent_jobs where status = 'running' and locked_until > now();
   select count(*) as jobs from public.agent_jobs;
   select count(*) as steps from public.agent_job_steps;
   ```

   前三个结果不一致就**停止**，把结果发回来。

4. **执行脚本**：二选一。
   - SQL Editor：打开 `supabase/release/0.5.0-step2.sql`，**整份粘贴、一次运行**。
   - psql：`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/release/0.5.0-step2.sql`。

   出现任何报错都说明已经整体回滚，**不要分段重跑**，把报错原文发回来。

5. **核对结果**：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;              -- 20261123100000
   select count(*) as jobs from public.agent_jobs;                              -- 等于第 3 步的 jobs
   select count(*) as steps from public.agent_job_steps;                        -- 等于第 3 步的 steps
   select count(*) from public.agent_jobs where not (payload ? 'limits');       -- 0
   select count(*) from public.agent_job_steps where seq is null;               -- 0
   select kind, status, work_item_id is not null as on_card, payload->'target'->>'type' as target
     from public.agent_jobs order by created_at desc limit 5;                    -- 出稿任务应 on_card = true
   select to_regprocedure('public.im_notify_target(uuid)');                     -- null（已删除）
   ```

   把这些结果原样发回来。

6. **部署 Edge Function**（`content-draft` 现在把稿件所属事项一起传给入队 RPC；旧版不传也能用）：

   ```bash
   supabase functions deploy content-draft
   ```

7. **用 0.5.0 分支的代码重启 worker**（`npm run worker:agent`，视频 worker 用新镜像）。旧版 worker 调用的是旧 RPC 签名，会直接报错，不能继续使用。

8. **不需要做的**：不要执行 `supabase db push`，不要修改函数的环境变量。

### 执行后

- 本地控制台（`.env.local` 指向线上库）验证：任务中心的轮次、任务详情的 Tokens / 成本 / 模型现在从步骤推出，旧任务的数字应和执行前一致；事项卡片的状态会随任务变化（`done` / `dropped` 的卡不动）。
- IM 通知：worker 主循环每 15 秒扫描一次待通知记录，发送成功才写 `notified_at`，失败下一轮重试。
- **出问题怎么回退**：脚本失败会自动回滚，不需要处理。脚本已经成功但想撤销时，只能用第 2 步的备份恢复。
