# 任务书：DB3b — Chat 结构化消息、运行时配置与节点能力目录（已实现，2026-11-25；step6 待上线）

> 2026-11-24 · 提交给数据库任务进行方案评审、编写迁移、测试并按 [../database.md](../database.md) DB-D14 规则演练发布。范围与批次已确认（[../modules/chat.md](../modules/chat.md) 第 5 节 C2、C3、C6、C7）。相关业务背景见 [../modules/chat.md](../modules/chat.md)。

> **实现记录（2026-11-25，T1）**：比任务书多做了三处防护——`chat_turn` 默认值触发器（任何途径创建都强制 `max_attempts=1` 并夹紧预算）；节点侧 Chat RPC 要求会话所有人就是任务创建人（防止浏览器经 `enqueue_agent_job` 伪造 `chat_turn` 读写他人会话）；发送 / 重新生成 / 按 id 认领时顺带清扫本会话的过期回合。`runtime_config` 额外授予了 `insert` 列权限。是否在数据库层彻底禁止手工入队 `chat_turn` 尚未决定（会影响 `agent-jobs-mvp-db.test.ts`）。

## 1. 背景与现状基线

### 1.1 已有迁移（事实）

1. **`supabase/migrations/20261124100000_runner_nodes.sql`（DB2c-2，已推线上）**：
   - 已建 `public.runner_nodes(id, organization_id, name, token_hash, revoked_at, last_seen_at, created_at)`。
   - 浏览器 `authenticated` 角色只被授予 `select (id, organization_id, name, revoked_at, last_seen_at, created_at)`（严禁暴露 `token_hash`）。
   - `public.node_claim(p_token, p_job_types, p_lease_seconds)` 目前按组织、任务类型与卡片串行规则认领队列任务，**尚不支持按指定节点（`target_node_id`）定向认领**。
2. **`supabase/migrations/20261126100200_chat.sql`（DB3，已编入 `supabase/release/0.5.0-step5.sql` 待执行）**：
   - 已建 `chat_sessions(id, organization_id, owner_id, work_item_id, title, exec_session, last_seq, archived_at, created_at, updated_at)`。
   - 已建 `chat_messages(id, organization_id, session_id, seq, role, content, agent_job_id, created_at)`。
   - 已建 `public.send_chat_message(p_session_id, p_content, p_run_agent)` 与 `public.node_append_chat_message(p_token, p_job_id, p_lease_epoch, p_content, p_exec_session)`。

3. **DB3 现有行为中与 Chat 回合强相关的几处细节（事实，评审补充）**：
   - `chat_turn` 被显式豁免了「同一事项卡串行」规则（`node_claim` / 卡片同步触发器里的 `q.kind = 'chat_turn'` 分支），而 **DB3 没有任何「同一会话串行」约束**：用户在上一轮未完成时再发一条，会并行出现两个 `chat_turn`，两条助手回复按完成先后抢 `seq`，与各自的用户消息错位。
   - `agent_jobs.max_attempts` 默认 **2**，`node_claim` 会把租约过期的 `running` 任务重新排队；而 `node_append_chat_message` 不做「每个任务只写一条助手消息」的幂等，节点在「已追加消息、未 `node_complete`」之间崩溃时，重试会**写出重复的助手回复**。
   - `send_chat_message` 调 `enqueue_agent_job` 时传的 `p_max_rounds = 1`；R3 的多步工具循环需要大于 1 的轮次上限。
   - `send_chat_message` 本身只校验 `content.view`，但 `p_run_agent = true` 时内部 `enqueue_agent_job` 还要求 **`agent.dispatch`**；`cancel_agent_job` 同样要求 `agent.dispatch`。
   - 节点没有能修改 `chat_sessions.title` 的入口，「自动命名」目前无处落地。

### 1.2 执行时机约束（DB-D14）

- DB-D14 约束的是**已推上线的迁移只能追加**。`0.5.0-step5.sql` 已演练但**尚未执行**，严格说仍可重新生成；但为了不阻塞最终批次上线，**建议**仍按独立增量 **DB3b**（例如 `20261127100000_chat_runtime_catalog.sql`，生成 `0.5.0-step6.sql`）追加，并通过 `testing/db/release.ts` 与 PGlite 测试验证。**已确认（2026-11-24，见 [../modules/chat.md](../modules/chat.md) 第 5 节 C3）：独立批次，不重新生成 step5。**

---

## 2. 需求拆解：6 项数据库增量改造

> 评审后优先级：**需求 0（回合正确性）与需求 4/5 中的 `node_claim_job` 是 R3-A 跑通首条链路的硬前置**；需求 5 的能力目录可在 R3-A 后半段再上。

### 需求 0（评审新增，最高优先级）：回合串行、幂等与回复归属

- **为什么需要**：见 1.1 第 3 点。不修的话，并发发送、重新生成、节点崩溃重试三种常见情况都会产生错位或重复的助手消息，而 `chat_messages` 是只追加表，事后无法修正。
- **建议变更**：
  1. `chat_messages` 新增 `reply_to_message_id uuid`（同组织外键指向 `chat_messages`，仅 `assistant` 行非空，必须指向同会话的 `user` 消息）。助手消息与哪条用户消息配对由此列决定，**不再依赖 `seq` 相邻**；这也直接回答第 3 节问题 2（重新生成的多个版本 = 同一 `reply_to_message_id` 下的多条助手消息，前端折叠为「版本 1/2」，不需要 `superseded` 状态）。
  2. 部分唯一索引 `unique (agent_job_id) where role = 'assistant'`：一个任务最多一条助手消息。`node_append_chat_message` 遇到同任务已有助手消息时**返回已有行**（幂等），而不是报错或再插一条。
  3. **同一会话同时只允许一个活跃回合**：`send_chat_message(p_run_agent = true)` 与 `regenerate_chat_turn` 在会话行锁下检查是否已有 `kind = 'chat_turn' and target_id = 会话 id and status in ('queued','running')` 的任务，有则拒绝（错误码供前端提示「上一轮还在生成」）；可再加部分唯一索引兜底。
  4. `chat_turn` 入队时 `max_attempts = 1`（不自动重试，失败由用户点「重试」走 `regenerate_chat_turn`），`max_rounds` 改为可配置（建议默认 8，上限 20），由 `p_runtime` 或常量决定。
  5. **单轮费用上限**：DB3 入队时 `p_budget_cents = null`（不限）。改为 `chat_turn` 必带 `budget_cents`：默认 50（即 0.5 元等值，按 `usage.costCents` 口径），`p_runtime.budget_cents` 可覆盖，**服务端夹紧在 1～500**，浏览器传多大都无效。worker 在每次模型调用前用已记录的 `agent_job_steps.usage` 累计费用对比 `budget_cents`，超出即停止，已产出部分以 `status = 'error'`、`code = 'budget_exceeded'` 落库（前端显示「本轮已达费用上限」并可重新生成）。ACP / BYOS 运行时由 CLI 自带订阅计费，`costCents` 可能为 0，此时只靠 `max_rounds` 与 HTTP 入口限流约束。按用户 / 组织的**日累计**预算暂不做，记为后续项（数据已在 `agent_job_steps.usage`，届时加一个汇总视图 + 入队检查即可）。
  5. 「完成回合」建议做成一次调用：`node_append_chat_message` 增加 `p_finish boolean default true`，在同一事务内追加消息并按 `p_status` 调 `complete_agent_job`（`completed → succeeded`、`cancelled → cancelled`、`error → failed`），消除「已追加未完成」的中间态。

### 需求 1：让 `chat_messages` 支持结构化 `parts` 与回合状态（支撑 AI Elements 与重试）

- **为什么需要**：前端将使用 shadcn AI Elements（`Reasoning` 思考过程、`Plan` 计划、`Task` 工具执行、`Stack Trace` 错误栈、`Attachment` 引用芯片、`Questionnaire` 确认卡）。只存纯文本 `content` 无法在刷新页面后还原这些结构化折叠块，也无法区分「已完成」「已中断」「报错待重试」。
- **建议变更**：
  1. `public.chat_messages` 新增两列：
     - `parts jsonb not null default '[]'::jsonb`：增加 CHECK 约束 `jsonb_typeof(parts) = 'array' and pg_column_size(parts) <= 262144`（上限 256KB，如有合理调整建议请评审指出）；
     - `status text not null default 'completed'`：CHECK 约束 `status in ('completed', 'cancelled', 'error')`。
  2. 原 `content` 列保留为纯文本摘要/降级显示与检索字段。
- **不变量保持**：`chat_messages` 依然只允许追加与节点写入 `assistant` 消息，浏览器只有 `SELECT` 权限。

### 需求 2：让 `chat_sessions` 持久化用户选用的模型 / CLI 配置

- **为什么需要**：用户切换到历史会话或刷新页面时，输入框上的 `Model Selector` 需要自动恢复该会话上次选中的云端 API 模型或本地 CLI 引擎及推理强度参数。
- **建议变更**：
  1. `public.chat_sessions` 新增列：`runtime_config jsonb not null default '{}'::jsonb`，CHECK 约束 `jsonb_typeof(runtime_config) = 'object' and pg_column_size(runtime_config) <= 8192`。
     - 典型内容：`{ "node_id": "...", "runtime_id": "api:qwen:qwen3.7-max", "driver_kind": "api", "model": "qwen3.7-max", "thinking_effort": "medium" }`。
  2. **权限注意**：向 `authenticated` 授予 `update (runtime_config)` 列权限（与已有 `work_item_id, title, archived_at` 并列），同时 `private.guard_chat_session()` 继续严禁浏览器修改 `last_seq`、`exec_session`、`owner_id`、`organization_id`。

### 需求 3：扩展 `send_chat_message` 并新增 `regenerate_chat_turn` RPC

- **为什么需要**：
  1. 用户发消息时可能附带 `@` 上下文芯片（存入 `user` 消息的 `parts`），同时指定本轮使用的运行时参数与目标节点（`runtime`、`target_node_id`）。
  2. 当某轮回复失败或用户点击「重新生成 / 换个模型重试」时，**不能重复插入一条相同的 `user` 消息**，而应基于原 `user` 消息重新入队一条 `chat_turn` 任务。
- **建议变更**：
  1. 扩展 `public.send_chat_message`（新参数均带默认值，保持与 DB3 原 3 参签名兼容）：
     - 新增参数：`p_parts jsonb default '[]'::jsonb`、`p_runtime jsonb default null`、`p_target_node_id uuid default null`。
     - **`p_target_node_id` 由收到 HTTP 请求的节点填入自己的 id**（节点以用户 JWT 代调本 RPC，见 [../modules/chat.md](../modules/chat.md) 2.4），浏览器不直接传；它是 payload 中的执行记录与 `node_claim` / `node_claim_job` 的兜底校验，不是路由手段（路由由「请求发给哪个节点」决定）。
     - 校验 `p_parts` 为数组（≤ 256KB）、若提供 `p_runtime` 则为对象（≤ 8KB）、若提供 `p_target_node_id` 则属于同组织且未吊销（`revoked_at is null`）。
     - 若 `p_run_agent = true`，写入 `agent_jobs.payload`：`schema_version`、`session_id`、`message_id`、`seq`，以及可选的 `runtime` 与 `target_node_id`；若用户指定了 `p_runtime`，可同步更新 `chat_sessions.runtime_config`（需经 `app.chat_write` 或合法列更新）。
  2. 新增 `public.regenerate_chat_turn`：
     - 参数：`(p_session_id uuid, p_user_message_id uuid, p_runtime jsonb default null, p_target_node_id uuid default null) returns jsonb`（`p_target_node_id` 同样由节点填入，同上）。
     - 鉴权：同 `send_chat_message`（登录用户、非匿名、会话 `owner_id = auth.uid()`、有 `content.view` 权限、未归档），且**需要 `agent.dispatch`**（由 `enqueue_agent_job` 强制）。
     - 校验：`p_user_message_id` 必须属于 `p_session_id` 且 `role = 'user'`；会话无活跃回合（需求 0 第 3 点）。
     - 行为：在会话行锁下生成新幂等键（如 `'chat_turn:regen:' || gen_random_uuid()::text`），调用 `enqueue_agent_job` 创建新 `chat_turn` 任务，payload 的 `message_id` 指向**原** user 消息，返回 `{ message_id, seq, agent_job_id }`（注意：`agent_jobs.payload` 仍保持不可变约束）。
     - 原 user 消息的 `agent_job_id` 只记录首次任务，不改写；回合与任务的对应关系以助手消息的 `agent_job_id` + `reply_to_message_id` 为准。
  3. **历史上下文边界**：一轮重新生成时，worker 只应把 `seq < 原 user 消息 seq` 的消息加上原 user 消息作为上下文（不包含原回复及其后的消息），由 `node_chat_context` 按 payload 的 `message_id` 截断返回（见需求 4）。

### 需求 4：为 `workers/agent` 提供 `node_chat_context` 并扩展 `node_append_chat_message`

- **为什么需要**：
  1. `workers/agent` 已在 DB2c-2 脱离 `service_role`，只能用节点令牌调用 `node_*` RPC。当前 DB3 中虽然有 `node_append_chat_message`，但**缺少让节点读取会话历史上下文和关联事项信息的 `node_*` 读取 RPC**。
  2. 节点完成或中止回复时，需要把结构化 `parts`（思考、计划、工具调用、报错栈）与 `status`（`completed` / `cancelled` / `error`）一并写回 `chat_messages`。
- **建议变更**：
  1. 新增 `public.node_chat_context(p_token text, p_job_id uuid, p_limit integer default 40) returns jsonb`：
     - 校验 `private.node_job(p_token, p_job_id)` 且 `j.kind = 'chat_turn'`。
     - 读取对应 `chat_sessions`（`id, title, work_item_id, exec_session, runtime_config, last_seq`）、**截至 payload `message_id` 那条 user 消息为止**的最近 `p_limit`（限 1～100）条 `chat_messages`（按 `seq asc` 排列返回，含 `id, seq, role, content, parts, status, reply_to_message_id, created_at`；同一 `reply_to_message_id` 有多个版本时只返回最新一条 `completed` 的版本）；若 `work_item_id` 不为空，附带返回 `work_items` 基本信息与关联 `content_documents` 摘要（不含敏感内部表）。
     - 返回 `parts` 只用于展示还原；**模型上下文默认只用 `content` 文本**（工具调用过程、思考块不回灌给模型，避免 token 膨胀和跨厂商格式不兼容）。
     - `p_limit` 只是数据库侧的条数上限（防一次拉太多）；**按 token 的精确截断在 worker 的 `loop/` 里做**（见 [../modules/chat.md](../modules/chat.md) 2.6），数据库不估算 token。
     - 授权给 `anon, authenticated, service_role`（与其它 `node_*` RPC 一致，函数内部由节点令牌鉴权）。
  2. 扩展 `public.node_append_chat_message`：
     - 在现有 `(p_token, p_job_id, p_lease_epoch, p_content, p_exec_session)` 基础上追加带默认值的参数：`p_parts jsonb default '[]'::jsonb`、`p_status text default 'completed'`（校验在 `'completed' | 'cancelled' | 'error'` 内且 `p_parts` 为合法数组）。
     - 同样透传写入 `private.append_chat_message`（注意允许 `error`/`cancelled` 时 `content` 可为简短错误/中断说明，或允许空字符串当 `parts` 非空时通过校验——请数据库任务在 `append_chat_message` 中一并评审长度规则）。
     - 同时写入 `reply_to_message_id`（取自任务 payload 的 `message_id`），并带上需求 0 的幂等与 `p_finish` 行为。
     - 追加可选 `p_title text default null`：仅当会话 `title = ''` 时由节点写入自动标题（用户改过标题即非空，不会被覆盖），经 `app.chat_write` 放行。这样「自动命名」不需要额外的列或 RPC。

### 需求 5：`runner_nodes` 能力目录（Runtime & Model Catalog）与按节点路由认领

- **为什么需要**：
  - 彻底解决控制台「Model Selector 不知道哪些节点在线、各自有哪些 API Profile 和本机 CLI 可用」的断层（见 [../modules/chat.md](../modules/chat.md) 第 3 节）。
  - 同时防止当用户明确选择「某台本地电脑上的 CLI (ACP)」时，任务被云端节点误认领。
- **建议变更**：
  1. `public.runner_nodes` 新增两列：
     - `capabilities jsonb not null default '{}'::jsonb`（CHECK：`jsonb_typeof(capabilities) = 'object' and pg_column_size(capabilities) <= 32768`）
     - `capabilities_updated_at timestamptz`
     - **列级授权**：将 `capabilities, capabilities_updated_at` 加入 `authenticated` 的 `SELECT` 授权列表，**确保 `token_hash` 依然绝不暴露给浏览器**。
  2. 新增 `public.node_report_capabilities(p_token text, p_capabilities jsonb) returns jsonb`：
     - 通过 `private.node_from_token(p_token)` 鉴权并刷新在线状态；
     - 校验 `p_capabilities` 为 JSON 对象且大小 ≤ 32768；`runtimes` 为数组且 ≤ 64 项；每项 `id` 匹配 `^(api|acp|exec):[a-z0-9._:-]{1,120}$`。
     - 防御性键名检查**按键名精确匹配**（递归检查所有对象键是否 ∈ `api_key / apikey / secret / password / authorization / access_token / refresh_token`），**不要做子串匹配**——否则会误杀 `max_tokens`、`inputTokens` 这类合法字段。另拒绝形如 `sk-…`、`stn_…` 的字符串值。这只是兜底，真正的保证是 worker 端只按白名单字段构造目录；
     - 更新 `runner_nodes.capabilities` 与 `capabilities_updated_at = now()`，返回更新后的时间戳。
  3. 升级 `public.node_claim(p_token, p_job_types, p_lease_seconds)`：
     - 在候选任务过滤条件中补充：`and (not (q.payload ? 'target_node_id') or q.payload->>'target_node_id' = n.id::text)`。
     - 若任务指定了 `target_node_id`，只有该节点能认领它；未指定时所有同组织节点均可按原规则认领。
  4. **可选补充（请评审）**：`agent_jobs.payload` 可针对 `target_node_id` 加 UUID 格式 CHECK 约束（与 `approval_request_id` 的校验方式一致）。
  5. **（评审改为必做）新增 `public.node_claim_job(p_token text, p_job_id uuid, p_lease_seconds integer default 120) returns jsonb`**：HTTP/SSE 入口按任务 id 原子认领。校验同组织、`status = 'queued'`、`kind = 'chat_turn'`、`target_node_id` 为空或等于本节点；成功则同 `node_claim` 写 `running / lease_epoch + 1 / node_id / locked_until`，否则返回 `null`（前端提示「已被其他节点处理或已取消」）。这是 HTTP 主路径成立的前提，见 [../modules/chat.md](../modules/chat.md) 2.4。
  6. **过期清理**：`queued` 状态超过 10 分钟仍无人认领的 `chat_turn`（浏览器发完消息就关页、目标节点离线）在 `node_claim` 的过期清扫里一并标为 `failed`（`error_code = 'chat_turn_unclaimed'`），否则会话会被需求 0 的「单活跃回合」永久卡住。

---

### 需求 6（2026-11-24 追加，可选）：`chat_messages` 加入 Realtime 发布

- **为什么**：Chat UI 第二波 A 已接好 `chat_messages` 插入订阅（停止生成后等落库的占位），但仓库迁移从未把任何表加入 `supabase_realtime` 发布，订阅收不到事件，目前只靠 2 秒轮询兜底。
- **变更**：`alter publication supabase_realtime add table public.chat_messages;`（Realtime 仍受 `chat_messages_read` RLS 约束，只推送会话所有者能读的行）。PGlite 测试中若无该发布对象，用 `do $$ … if exists (select 1 from pg_publication where pubname = 'supabase_realtime') …` 包一层。
- **若 DB3b 已完成**，此项留到下一批，不必返工。

## 3. 请数据库任务在执行前评审并确认的问题

> 原第 2～4 问已在评审中给出结论，保留在此便于追溯。

1. **同名函数重载 vs `drop function`**：扩展 `send_chat_message` 与 `node_append_chat_message` 参数时，Postgres 若不先 `drop` 旧签名会产生函数重载导致 PostgREST `rpc` 歧义。建议在迁移中明确 `drop` 旧签名并重建新签名（同 DB2c-1 做法），并同步 `revoke/grant`；目前两者都还没有线上调用方（Chat 未上线），影响面只在仓库测试。
2. ~~重新生成时的旧消息处理~~ → **结论**：用 `reply_to_message_id`（需求 0），不加 `replaces_message_id`、不加 `superseded` 状态。
3. ~~HTTP/SSE 与队列写入一致性~~ → **结论**：`node_claim_job` 改为必做（需求 5 第 5 点）；队列轮询默认**不认领** `chat_turn`（`p_job_types` 不含它），HTTP 入口是 `chat_turn` 的唯一执行路径；未被认领的回合由需求 5 第 6 点清理。IM 等无浏览器场景以后若要走队列，再给节点单独开启。
4. ~~节点目录数量限制~~ → **结论**：限制 `runtimes` ≤ 64，并加 `id` 格式校验（需求 5 第 2 点）。
5. **（新增）HTTP 入口以用户身份写消息**：HTTP 主路径下 worker 持用户 JWT 调 `send_chat_message` / `regenerate_chat_turn`，再用节点令牌调 `node_claim_job`。请确认 `send_chat_message` 在 `security definer` 下通过 PostgREST（用户 JWT）调用时 `auth.uid()` / `is_anonymous` 判定不受影响（预期不受影响，补一条测试即可）。

---

## 4. 验收与测试要求

完成后需在 `supabase/tests/db/` 新增或扩充测试文件（PGlite 实测），至少覆盖以下用例：

1. **权限与防伪造**：浏览器无法直接 `INSERT` / `UPDATE` `chat_messages`、`chat_sessions.last_seq`、`chat_sessions.exec_session`、`runner_nodes.capabilities`、`runner_nodes.token_hash`；非本组织或非会话所有者调用 `send_chat_message` / `regenerate_chat_turn` 被拒绝。
2. **结构化消息与重试**：`send_chat_message` 写入 `parts`、`runtime`、`target_node_id`；`regenerate_chat_turn` 不新增 `user` 消息且成功入队新 `chat_turn`；`node_append_chat_message` 支持写入 `parts` 与 `status='error'/'cancelled'`，且 `lease_epoch` 不匹配或非 `chat_turn` 任务时拒绝。
3. **节点上下文与定向认领**：`node_chat_context` 跨组织或未持有任务时拒绝，持有任务时返回完整消息列表与关联事项，重新生成时只返回截至原 user 消息的上下文；`node_claim` 与 `node_claim_job` 都不会让节点 A 认领 `target_node_id = B` 的任务；`node_claim_job` 对已 `running` / `cancelled` 的任务返回 `null`。
4. **回合正确性（需求 0）**：同会话已有活跃回合时 `send_chat_message(p_run_agent=true)` 与 `regenerate_chat_turn` 被拒绝；同一任务重复调用 `node_append_chat_message` 只产生一条助手消息；`p_finish = true` 后任务状态与消息 `status` 对应；超时未认领的 `chat_turn` 被清理后会话可再次发送；节点写 `p_title` 不覆盖用户已改的标题；`chat_turn` 的 `budget_cents` 缺省为 50、传入超过 500 时被夹紧为 500。
5. **发布演练与全量门禁**：待 `0.5.0-step5.sql` 流程确定后，确保根目录 `npm run typecheck && npm run lint && npm test` 全绿（含迁移快照与发行脚本校验）。
