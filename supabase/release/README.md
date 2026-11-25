# 上线脚本与执行手册

这里放的是**从迁移文件生成**的上线脚本，不要手改。改了迁移就重新生成：

```bash
npx tsx testing/db/release.ts          # 生成 supabase/release/0.5.0-step{1,2,3,4,5,6}.sql
npx vitest run testing/db/release*.test.ts   # 在模拟线上状态的 PGlite 上演练
```

背景见 [docs/database.md](../../docs/database.md) 第 8 节和 DB-D14：线上库同时作为开发、测试和正式环境，迁移分批推送。

## 线上批次状态

| 批次 | 脚本 | 覆盖步骤与迁移 | 状态 |
| --- | --- | --- | --- |
| 第 1 批 | `0.5.0-step1.sql` | DB2a + DB2b（`20261115090000`～`20261122100000`） | 已在线上执行 |
| 第 2 批 | `0.5.0-step2.sql` | DB2c-1（`20261123100000`） | 已在线上执行 |
| 第 3 批 | `0.5.0-step3.sql` | DB2c-2（`20261124100000`） | 已在线上执行（2026-11-21 核对通过：`max=20261124100000`、`runner_nodes=0`、`node_*=12`、`agent_jobs_node_id_fkey` 存在） |
| 第 4 批 | `0.5.0-step4.sql` | DB2c-3（`20261125100000`：AI 直接写草稿、退役 `content_ai_proposals`） | 已在线上执行（2026-11-23 核对通过：`max=20261125100000`、`content_ai_proposals` 已删、`node_*=12`；真实出稿一次跑通） |
| 第 5 批（最终） | `0.5.0-step5.sql` | DB4 + DB5 + DB3 + V1 退役（`20261126100000`～`20261126100300`） | 已生成并通过 PGlite 演练，待 Codex 执行（给 Codex 的提示词：[0.5.0-step5-codex-prompt.md](0.5.0-step5-codex-prompt.md)） |
| 第 6 批 | `0.5.0-step6.sql` | DB3b（`20261127100000`：Chat 回合正确性、结构化消息、运行时配置、节点能力目录、`node_claim_job`） | 2026-11-25 已执行并核对 |

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

---

## 0.5.0 第 3 批（DB2c-2：执行节点身份）

**做什么**：在一个事务里执行迁移 `20261124100000_runner_nodes`，任何一步失败都会整体回滚。

1. 前置检查：迁移历史最后一条必须是 `20261123100000`；`runner_nodes` 还不存在。
2. 新建 `runner_nodes`（节点令牌只存 sha256 哈希，浏览器读不到这一列）；`agent_jobs.node_id` 加外键。
3. 新增 `create_runner_node` / `revoke_runner_node`（需要 `organization.manage`）和 12 个 `node_*` RPC（worker 用公开 key + 节点令牌调用）。
4. 写入迁移历史。

**不做什么**：不改已有数据、不删任何对象，原有带 `service_role` 的节点 RPC 全部保留（视频 worker 还在用）。**不需要停 worker**：正在运行的旧 worker 可以把手上的任务做完。脚本里没有密钥。

### 给 Codex 的执行步骤

> 执行人：Codex。需要项目的数据库连接，或 Supabase Dashboard 的 SQL Editor 权限。**不要在输出或日志里打印任何密钥、连接串、项目 ID 或节点令牌。**

1. **备份**：这一批只新增对象、不改数据，可以不做数据备份；有 CLI 时可选 `supabase db dump -f backup-0.5.0-step3-schema.sql`，放在仓库外。

2. **只读预检**：结果应为 `20261123100000`、`null`：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;
   select to_regclass('public.runner_nodes');
   ```

   结果不一致就**停止**，把结果发回来。

3. **执行脚本**：二选一。
   - SQL Editor：打开 `supabase/release/0.5.0-step3.sql`，**整份粘贴、一次运行**。
   - psql：`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/release/0.5.0-step3.sql`。

   出现任何报错都说明已经整体回滚，**不要分段重跑**，把报错原文发回来。

4. **核对结果**：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;               -- 20261124100000
   select count(*) from public.runner_nodes;                                     -- 0
   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'node\_%';                      -- 12
   select conname from pg_constraint where conname = 'agent_jobs_node_id_fkey';  -- 1 行
   ```

   把这些结果原样发回来。

5. **不需要做的**：不部署 Edge Function，不执行 `supabase db push`，不修改函数的环境变量，**不要替用户创建节点**（令牌只能由用户在控制台生成并自己保存）。

### 执行后（用户自己做）

1. 本地控制台 →「本地 Agent」→「执行节点」→ 新建节点（如 `jarvis-mac`），复制只显示一次的令牌。
2. 改 `workers/agent/.env.local`：删掉 `SUPABASE_SERVICE_ROLE_KEY`，加 `SUPABASE_PUBLISHABLE_KEY=`（与控制台相同的公开 key）和 `SENSE_NODE_TOKEN=`（刚复制的令牌）。
3. 用 0.5.0 分支的代码重启 worker。控制台里节点状态应在几秒内变为「在线」，发起一次「交给 Agent 出稿」验证。
4. 确认新 worker 正常后，可以到 Supabase Dashboard 轮换（重新生成）之前给 worker 用的那把 secret key——它已经不再需要。

- **出问题怎么回退**：脚本失败会自动回滚。脚本成功但新 worker 有问题时，旧的 `service_role` 路径仍在，可以先用上一个提交的 worker 代码顶上。

---

## 0.5.0 第 4 批（DB2c-3：AI 直接写草稿）

**做什么**：在一个事务里执行迁移 `20261125100000_ai_direct_draft`，任何一步失败都会整体回滚。

1. 前置检查：迁移历史最后一条必须是 `20261124100000`；`node_write_document_draft` 还不存在；**没有任何 `content_draft` 任务持有未过期的租约**（agent worker 必须先停）。
2. 删除 `public.node_save_proposal(text, uuid, bigint, jsonb)` 与退役表 `public.content_ai_proposals`。
3. 新增 `public.write_document_draft`（校验运行中任务的 `lease_epoch`、目标稿件与 `base_revision` 乐观锁，按任务发起人身份更新 `content_documents`、触发版本号递增和快照、写入 `audit_events` 并记录 `agent_jobs.result.written_revision`）与 `public.node_write_document_draft`（保持 `node_*` 共 12 个）。
4. 新增 `content_documents` 触发器 `document_complete_draft_jobs`：稿件审核通过（`status = 'approved'`）时，自动将该稿件下处于 `pending_review` 的 `content_draft` 任务置为 `succeeded`。
5. 写入迁移历史。

**不做什么**：不删 V1 收集/项目/历史表（留到最后退役批次），脚本里没有密钥。

### 给 Codex 的执行步骤

> 执行人：Codex。需要项目的数据库连接，或 Supabase Dashboard 的 SQL Editor 权限。**不要在输出或日志里打印任何密钥、连接串、项目 ID 或节点令牌。**

1. **停掉本机 agent worker**（`npm run worker:agent`），若之前已有运行中的 `content_draft` 任务需等其租约过期（默认 2 分钟）。

2. **备份**（可选；`content_ai_proposals` 线上快照为 0 行，但执行前建议在 Table Editor 确认或做 schema/data 备份）：
   - 有 CLI 时可选：`supabase db dump --data-only -f backup-0.5.0-step4-data.sql`，以及 `supabase db dump -f backup-0.5.0-step4-schema.sql`。
   - 备份文件放在仓库外，不要提交。

3. **只读预检**：结果应为 `20261124100000`、`0`、`0`（以及 `proposals` 确认行数）：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;
   select count(*) from public.agent_jobs where kind = 'content_draft' and status = 'running' and locked_until > now();
   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'node_write_document_draft';
   select count(*) as proposals from public.content_ai_proposals;
   ```

   前三个结果不一致就**停止**，把结果发回来。

4. **执行脚本**：二选一。
   - SQL Editor：打开 `supabase/release/0.5.0-step4.sql`，**整份粘贴、一次运行**。
   - psql：`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/release/0.5.0-step4.sql`。

   出现任何报错都说明已经整体回滚，**不要分段重跑**，把报错原文发回来。

5. **核对结果**：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;                       -- 20261125100000
   select to_regclass('public.content_ai_proposals');                                    -- null（已退役）
   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'node\_%';                              -- 12
   select to_regprocedure('public.node_write_document_draft(text,uuid,bigint,uuid,integer,text,text)'); -- 非 null
   ```

   把这些结果原样发回来。

6. **不需要做的**：不执行 `supabase db push`，不修改函数环境变量；如控制台刚改为直连 `enqueue_agent_job` RPC，本批也无需重部署 Edge Function（`content-draft` Edge Function 若不再调用可按需同步部署更新以关闭 `mode=sync`）。

### 执行后

- 用当前分支代码重启本机 `npm run worker:agent`（需已配置 `SUPABASE_PUBLISHABLE_KEY` 与控制台新建节点的 `SENSE_NODE_TOKEN`）和本地控制台 `npm --prefix sense-console run dev`。
- 在控制台完整跑通一轮：收件箱/速记 → 事项 → 新建母稿 →「交给 Agent 出稿」→ 编辑器自动载入 AI 写入的新版本草稿 → 提交审核并审核通过 → 导出 Markdown，并核对任务中心已自动转为「已完成」。
- **出问题怎么回退**：脚本失败会自动回滚，不需要处理。脚本已经成功但想撤销时，只能用第 2 步备份恢复。

---

## 0.5.0 第 5 批（最终批次：DB4 + DB5 + DB3 + V1 退役）

**做什么**：在一个事务里执行 4 个迁移，任何一步失败都会整体回滚。执行后 public schema 只剩 **21 张表、0 个视图**（[database.md](../../docs/database.md) 第 3 节、DB-D17）。

1. 前置检查：迁移历史最后一条必须是 `20261125100000`；`chat_sessions` 还不存在；**没有任何任务持有未过期的租约**（所有 worker 先停）；`content_project_assets`、外部发布三表、视频与知识表为空；读者站 `site_*` 除 `site_settings` 外为空。任一不满足就中止。
2. `20261126100000_publish_on_documents`（DB4）：`content_documents` 新增 `published_revision / published_title / published_body / published_meta / published_at / published_url / slug`；新 RPC `publish_document`、`unpublish_document`、`set_document_published_url`；触发器禁止直接写发布列；`anon` 只授予发布列，RLS 只放行已发布行；删除本地 `site_*` 12 表（线上 `site_settings` 1 行配置随之删除）及其函数、外部发布三表。
3. `20261126100100_video_mvp`（DB5）：`video_plans` 改挂 `work_item_id`；删除分镜提案、成本账本、成本视图及其 RPC；镜头去成本列；`approval_requests.estimated_cost_cents` 并入 `payload`；新增 `write_video_draft` / `node_write_video_draft`（删除 `node_save_storyboard_proposal`、`node_storyboard_knowledge`，`node_*` 仍为 12 个）。
4. `20261126100200_chat`（DB3）：新建 `chat_sessions`、`chat_messages`、`send_chat_message`、`node_append_chat_message`。
5. `20261126100300_retire_v1`：**最后一次** `private.backfill_v1()`（会把后来新增的审核记录补进 `audit_events`，2026-11-26 线上实测为 12 条），然后对账：每条 `signals` / `intake_receipts` / `selections` / `content_projects` / `content_review_events` 都必须在新表找到对应行、稿件全部挂在事项上，否则整体回滚；改写审核历史触发器（写 `audit_events`）；`content_documents.work_item_id` 改必填并删 `project_id`；删除 `signals`、`selections`、`intake_receipts`、OAuth 三表、`content_projects`、`content_project_assets`、`content_revisions`、`content_review_events`、`knowledge_entries`、`decision_memories` 与 `intake_oauth`、`backfill_v1`。
6. 写入迁移历史。

**会删除的有数据的表**（2026-11-26 线上行数）：`signals` 34、`selections` 4、`content_projects` 1、`intake_receipts` 2、`content_revisions` 12、`content_review_events` 21、`site_settings` 1。前五类已回填到 `intake_events` / `work_items` / `audit_events`（脚本内对账）；`content_revisions` 是历史正文快照，按 R2 不迁移，**只保存在备份里**。

**不做什么**：不改 `prompt_examples`、`assets`、`storage_provider_configs`；不删存储桶（`site-resources` 线上为空，保留无害）；脚本里没有密钥。

### 给 Codex 的执行步骤

> 执行人：Codex。需要项目的数据库连接，或 Supabase Dashboard 的 SQL Editor 权限。**不要在输出或日志里打印任何密钥、连接串、项目 ID 或节点令牌。**

0. **代码先就位**：使用 `0.5.0` 分支包含 `0.5.0-step5.sql` 的提交（本地 `git pull`），先在本地跑一遍门禁：

   ```bash
   npm install && npm run typecheck && npm run lint && npm test && npm run test:video-worker
   npx vitest run testing/db/release-step5.test.ts
   ```

1. **停掉所有 worker**：本机 `npm run worker:agent`、视频 worker 进程或容器。等 2～5 分钟让租约过期。

2. **备份（必须）**：这一批删除有数据的表，免费版没有自动备份。
   - 有 CLI 时：`supabase db dump --data-only -f backup-0.5.0-step5-data.sql`，以及 `supabase db dump -f backup-0.5.0-step5-schema.sql`。
   - 没有 CLI 时：在 Dashboard → Table Editor 把 `signals`、`selections`、`intake_receipts`、`content_projects`、`content_documents`、`content_revisions`、`content_review_events`、`site_settings`、`approval_requests`、`audit_events` 分别 Export → CSV。
   - 备份文件放在仓库外，不要提交。

3. **只读预检**：

   ```sql
   select
    (select max(version) from supabase_migrations.schema_migrations) as head,                       -- 20261125100000
    (select count(*) from public.agent_jobs where status='running' and locked_until > now()) as live_leases,   -- 0
    (select count(*) from public.content_project_assets) as project_assets,                         -- 0
    (select count(*) from public.publishing_channels)+(select count(*) from public.content_publications)+(select count(*) from public.publication_metrics) as ext_publish,  -- 0
    (select count(*) from public.video_plans)+(select count(*) from public.video_storyboard_proposals)+(select count(*) from public.video_cost_entries)
      +(select count(*) from public.knowledge_entries)+(select count(*) from public.decision_memories) as video_knowledge,   -- 0
    (select count(*) from public.site_entries)+(select count(*) from public.site_entry_releases)+(select count(*) from public.site_resources)+(select count(*) from public.site_bookmarks) as site_rows,  -- 0
    (select count(*) from public.content_documents where work_item_id is null) as docs_without_item,   -- 0
    to_regclass('public.chat_sessions') as chat;                                                    -- null
   ```

   任一结果不符就**停止**，把结果原样发回来。

4. **执行脚本**：二选一。
   - SQL Editor：打开 `supabase/release/0.5.0-step5.sql`，**整份粘贴、一次运行**。
   - psql：`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/release/0.5.0-step5.sql`。

   出现任何报错都说明已经整体回滚，**不要分段重跑**，把报错原文发回来。成功时会有一条 `backfill_v1 (final): {...}` 通知，原样记下。

5. **核对结果**：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;                                  -- 20261126100300
   select count(*) filter (where c.relkind = 'r') as tables, count(*) filter (where c.relkind in ('v','m')) as views
     from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m');   -- 21, 0
   select to_regclass('public.signals'), to_regclass('public.content_projects'), to_regclass('public.site_settings'),
          to_regclass('public.knowledge_entries'), to_regclass('public.video_cost_entries');       -- 全部 null
   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'node\_%';                                       -- 12
   select is_nullable from information_schema.columns
    where table_schema='public' and table_name='content_documents' and column_name='work_item_id';  -- NO
   select count(*) from public.audit_events where metadata->'legacy' ? 'review_event_id';          -- 21（= 原 content_review_events 行数）
   select count(*) from public.intake_events where payload->'legacy' ? 'signal_id';                -- 34（= 原 signals 行数）
   select has_column_privilege('anon','public.content_documents','published_body','select') as anon_published,  -- true
          has_column_privilege('anon','public.content_documents','body','select') as anon_draft;                -- false
   ```

   把这些结果和第 4 步的 `backfill_v1 (final)` 通知原样发回来。

6. **部署前端**（顺序：数据库之后立刻做；执行完第 4 步后线上 V1 控制台已不可用）：
   - `sense-console`：`npm --prefix sense-console ci && npm --prefix sense-console run build`，按现有方式替换线上控制台（story.susense.cn）。
   - `sense-site`：`npm --prefix sense-site ci && npm --prefix sense-site run build`，环境变量只需 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`（可选 `VITE_SITE_NAME`、`VITE_SITE_ORGANIZATION_ID`），**`VITE_SITE_DEMO` 必须为空**。
   - Edge Functions 本批不需要重部署（未引用被删除的对象）；如果 `content-draft` 还是 DB2c-3 之前的版本，可顺带 `supabase functions deploy content-draft`。

7. **用新代码重启 worker**：`npm run worker:agent`（公开 key + 节点令牌）；视频 worker 用新镜像（不再写成本账本）。

8. **不需要做的**：不执行 `supabase db push`，不修改函数环境变量，不删除存储桶。

### 执行后验收（人在控制台做一遍）

1. 收件箱 / 速记 → 事项 → 新建母稿 →「交给 Agent 出稿」→ 编辑器自动载入 AI 写入的新版本。
2. 提交审核并通过 → 发布面板「一键批准并发布」→ 打开读者站，文章可见；改稿后读者站仍是旧版本；「下线」后读者站读不到。
3. 在平台稿上回填一个外部发布链接 →「发布记录」页能看到。
4. 视频工坊「从大纲开始」→ Agent 直接生成分镜草稿（不再有「采纳提案」一步）。
5. 知识库页能看到仓库 `knowledge-base/` 的 3 条条目（只读）；菜单里不再有「发布运营」和「决定记忆」。

**出问题怎么回退**：脚本失败会自动回滚，不需要处理。脚本成功后想撤销，只能用第 2 步的备份恢复，并重新部署 V1 控制台。

## 0.5.0 第 6 批（DB3b：Chat 运行时与节点能力目录）

**做什么**：在一个事务里执行 1 个迁移 `20261127100000_chat_runtime_catalog`（设计与实现见 [docs/modules/chat.md](../../docs/modules/chat.md) 第 6.1 节）。不删表、不删数据，已有会话和消息原样保留（新列取默认值）。

1. 前置检查：迁移历史最后一条必须是 `20261126100300`（第 5 批已执行）；`node_claim_job` 还不存在；**没有 `queued` / `running` 的 `chat_turn` 任务**（回合任务的形状和 `node_append_chat_message` 签名都变了）。任一不满足就中止。
2. `chat_messages` 新增 `parts`（≤ 256KB 数组）、`status`（`completed / cancelled / error`）、`reply_to_message_id`（只给 assistant 行，指向本会话的 user 消息）；每个任务最多一条助手消息（部分唯一索引）。
3. `chat_sessions` 新增 `runtime_config`（≤ 8KB 对象），浏览器可插入 / 修改这一列；`last_seq`、`exec_session` 仍只能由服务端写。
4. `agent_jobs`：`chat_turn` 的 `max_rounds` 上限放宽到 20（其他任务仍为 5）；`payload.target_node_id` 必须是 UUID；同一会话同时只允许一个 `queued / running` 的回合（部分唯一索引兜底）；所有 `chat_turn` 强制 `max_attempts = 1`、`budget_cents` 夹紧在 1～500。
5. RPC：`send_chat_message` 改为 6 参（新增 `p_parts`、`p_runtime`、`p_target_node_id`，先删旧 3 参签名）；新增 `regenerate_chat_turn`；`node_append_chat_message` 改为 9 参（新增 `p_parts`、`p_status`、`p_finish`、`p_title`，幂等）；新增 `node_chat_context`、`node_report_capabilities`、`node_claim_job`；`node_claim` 增加 `target_node_id` 过滤与「10 分钟无人认领的回合标为失败（`chat_turn_unclaimed`）」清扫。`node_*` 从 12 个变为 15 个。
6. `runner_nodes` 新增 `capabilities`（≤ 32KB）与 `capabilities_updated_at`，浏览器只读这两列，`token_hash` 仍不可读。
7. 若存在 `supabase_realtime` 发布，把 `public.chat_messages` 加入（推送仍受 `chat_messages_read` RLS 约束）。
8. 写入迁移历史。

**不做什么**：不改其他表；不需要重新部署 Edge Functions；脚本里没有密钥。

### 给 Codex 的执行步骤

> 执行人：Codex。需要项目的数据库连接，或 Supabase Dashboard 的 SQL Editor 权限。**不要在输出或日志里打印任何密钥、连接串、项目 ID 或节点令牌。** 用户明确说「开始执行 step6」之前，只做第 0 步并汇报。

0. **代码先就位**：使用包含 `0.5.0-step6.sql` 的提交，先在本地跑一遍门禁：

   ```bash
   npm install && npm run typecheck && npm run lint && npm test
   npx vitest run testing/db/release-step6.test.ts
   ```

1. **停掉 agent worker**（`npm run worker:agent`），并确认控制台里没有正在生成的 Chat 回合。视频 worker 不受影响，可以不停。

2. **备份**：这一批不删数据，建议仍做一次结构备份：有 CLI 时 `supabase db dump -f backup-0.5.0-step6-schema.sql`（放在仓库外，不要提交）。

3. **只读预检**：

   ```sql
   select
    (select max(version) from supabase_migrations.schema_migrations) as head,                          -- 20261126100300
    (select count(*) from public.agent_jobs where kind = 'chat_turn' and status in ('queued','running')) as chat_turns_in_flight,  -- 0
    to_regprocedure('public.node_claim_job(text,uuid,integer)') as claim_job,                          -- null
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'node\_%') as node_rpcs,                           -- 12
    exists (select 1 from pg_publication where pubname = 'supabase_realtime') as realtime_pub;         -- true（为 false 也可执行，只是不加发布）
   ```

   任一结果不符就**停止**，把结果原样发回来。

4. **执行脚本**：二选一。
   - SQL Editor：打开 `supabase/release/0.5.0-step6.sql`，**整份粘贴、一次运行**。
   - psql：`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/release/0.5.0-step6.sql`。

   出现任何报错都说明已经整体回滚，**不要分段重跑**，把报错原文发回来。

5. **核对结果**：

   ```sql
   select max(version) from supabase_migrations.schema_migrations;                                   -- 20261127100000
   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'node\_%';                                        -- 15
   select p.proname, p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('send_chat_message','regenerate_chat_turn','node_append_chat_message')
    order by 1;                                                                                     -- node_append_chat_message 9 / regenerate_chat_turn 4 / send_chat_message 6（各一行，无重载）
   select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_messages' and column_name in ('parts','status','reply_to_message_id')
    order by 1;                                                                                     -- parts / reply_to_message_id / status
   select has_column_privilege('authenticated','public.runner_nodes','capabilities','select') as caps,      -- true
          has_column_privilege('authenticated','public.runner_nodes','token_hash','select') as token_hash,  -- false
          has_column_privilege('authenticated','public.chat_sessions','runtime_config','update') as runtime_config,  -- true
          has_column_privilege('authenticated','public.chat_sessions','last_seq','update') as last_seq;     -- false
   select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages';  -- 1（预检 realtime_pub 为 false 时为 0）
   ```

   把这些结果原样发回来。

6. **重启 worker**：用包含 DB3b 调用的新 worker 代码 `npm run worker:agent`。旧 worker 若调用 3 参 `send_chat_message` 或 5 参 `node_append_chat_message` 会因签名不存在而失败（Chat 在此之前未上线，没有线上调用方）。

7. **不需要做的**：不执行 `supabase db push`，不重部署 Edge Functions，不修改函数环境变量。

### 执行后验收

1. 控制台 Chat 发一条消息 → 节点认领并流式回复 → 刷新页面后回复、思考 / 工具卡片仍在（`parts`）。
2. 生成中再发一条 → 被拒绝（「上一轮还在生成」）；点「重新生成」→ 没有新增 user 消息，出现「版本 2」。
3. 模型 / CLI 选择器能列出在线节点上报的运行时（`runner_nodes.capabilities`）。

**出问题怎么回退**：脚本失败会自动回滚。脚本成功后若要撤销，按第 2 步的结构备份恢复相关函数与列；本批不删数据，已有会话不受影响。
