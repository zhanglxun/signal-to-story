# 速记（Quick Capture）与「采集 → 自动出稿待审」（P3）

基于 [Agent Harness 内核](agent-harness.md)。迁移：`supabase/migrations/20261117100000_quick_capture.sql`。

## RPC 与身份模型

| 函数 | 调用方 | 身份 |
| --- | --- | --- |
| `quick_capture(p_organization_id uuid, p_url text, p_note text, p_intent text, p_platforms text[], p_idempotency_key text, p_title text default null) → jsonb` | 浏览器（authenticated） | 调用者 JWT；需 `content.manage`，`auto_draft` 另需 `agent.dispatch` |
| `quick_capture_for_connection(p_token_hash text, p_input jsonb) → jsonb` | 仅 service_role（intake-gateway、P4 IM 适配层） | 组织与用户取自 `intake_connections`（凭证摘要），请求不能指定；连接创建人须仍有上述权限 |

- 意图：`capture_only` 仅建信源 + 候选选题；`auto_draft` 在**同一事务**内建信源 → 选题 → `content_projects`（`selection_id` 关联）→ 母稿 + 所选平台稿（空正文，v1）→ 每篇稿件一条 `content_draft` 任务（`enqueue_agent_job`，幂等键 `quick_capture:<capture_id>:<platform>`，payload 含 `instruction`、`quick_capture_id`、`fetch_source`）。任一步失败整体回滚。
- 幂等：`quick_captures(organization_id, idempotency_key)` 唯一，咨询锁串行化同键重试；同键同输入返回原结果（`duplicate: true`），同键不同输入 `idempotency_conflict`。浏览器每次“新提交”生成 `web-<uuid>`，失败重试复用同一键；连接通道键为 `conn:<connection_id>:<external_id>`（浏览器不能使用 `conn:` 前缀）。
- 服务端通道的身份绑定：函数校验凭证后，仅在本次调用内把 `request.jwt.claims.sub` / `request.jwt.claim.sub` 设为连接创建人，使既有触发器（稿件守卫、版本快照、任务状态机、审计）按该用户执行；**`role` 保持 service_role**，因此 `decide_approval_request` 等仅限人类的动作仍不可用；调用结束恢复原 claims。
- `p_input`（连接通道）：`{version:1, intent:'capture'|'capture_only'|'auto_draft', external_id, text, title?, url?, angle?, platforms?[]}`；`capture` 原样委托 `accept_intake`（沿用回执与防重）。限流：每连接每小时 100 条（与 `accept_intake` 合计），浏览器每用户每小时 120 条。
- 返回：`{capture_id, intent, duplicate, signal_id, selection_id, project_id, documents:[{platform, document_id, job_id}], topic_path, project_path}`。
- `intake-gateway` 已支持 `intent: "auto_draft"` + `platforms`（→ `quick_capture_for_connection`）；`capture` 请求形态与行为不变。

## Worker 链路

`稿件 → content_projects.selection_id → selections.signal_id → signals`（信源名、链接、备注）即 P1.5 的取数路径，无需改动。`payload.fetch_source=true` 时，worker 在 round 0 记录一条 `fetch` 步骤（`workers/agent/fetch-source.ts`）：

- 仅 http/https、默认端口、无内嵌凭证；解析到的**每个**地址都必须是公网地址（拒绝 loopback/私网/链路本地/CGNAT/组播/保留段及 IPv4 映射形式），校验在 socket `lookup` 钩子里完成，避免 DNS rebinding；重定向手动跟随 ≤3 次并逐跳复检；2 MB / 10 秒上限；只接受 text/html、text/plain，抽取纯文本 ≤12000 字。
- 抓到的正文作为 `web:<signal_id>` 放进 Context Pack 的不可信区；失败时步骤记为 failed（含错误码），只用用户备注继续出稿。恢复执行时复用已落库的 fetch 步骤，不重复抓取。

## 前端

- 顶栏「速记」按钮与 `⌘/Ctrl + K` → `QuickCaptureDialog`（`src/components/quick-capture/`）。
- `/capture`：登录后可用、AppShell 之外的极简移动页（可“添加到主屏幕”）。
- `/tasks`、`/tasks/:id`：真实 `agent_jobs` / `agent_job_steps`，分组“等我审核 / 等我拍板（含待批准请求）/ 异常阻塞 / 进行中 / 已完成”；详情展示每轮生成、预检、评估清单、反馈、模型、tokens、成本、耗时，可取消、追加一轮继续、跳转稿件页查看提案。

## 验收

`npm run demo:capture`（PGlite + fake 抓取 + fake LLM）打印全链路并以 `PASS: 2/2 pending_review proposals` 结束。测试：`src/test/db/quick-capture-db.test.ts`、`workers/agent/quick-capture-e2e.test.ts`、`workers/agent/fetch-source.test.ts`、`src/test/quick-capture.test.tsx`。
