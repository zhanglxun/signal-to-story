# Agent 执行：任务队列、循环、Mandate 门禁

> 由旧 `agent-harness.md` 和 `workers/agent/README.md` 精简而来。描述的是 `codex/0.3` 的功能现状（路径已按 R1 更新）；0.5 的调整方向见第 6 节。

## 1. 组成（现状路径）

| 部分 | 当前位置 | 目标位置 |
| --- | --- | --- |
| 契约 | `sense-console/src/contracts/agent-*.ts` | `workers/agent/loop/`（R2；前端依赖先盘点，见 architecture 6.2） |
| 循环纯函数 | `sense-console/src/harness/*` | `workers/agent/loop/`，R3 在其中新建统一 Agent 循环（R2/R3） |
| worker | `workers/agent/*` | 已就位 |
| 数据库 | `supabase/migrations/20261115100000/100100/100200`，DB2c-1 精简 `20261123100000` | 已就位 |
| 入队入口 | Edge Function `supabase/functions/content-draft`（`mode: "queue"`） | 不变 |

## 2. 表

| 表 | 作用 | 浏览器 | worker |
| --- | --- | --- | --- |
| `agent_jobs` | 任务队列：幂等键（组织内唯一）、租约（`lease_epoch`）、`work_item_id`；目标、批准、上限在 `payload.target / approval_request_id / limits` | 只读；写只能经 RPC | 只能经 RPC 认领、心跳、完成 |
| `agent_job_steps` | 每一步一行，`unique(job_id, seq)`，只追加；轮次、评估在 `output`，模型、费用、耗时在 `usage` | 只读 | 只能经 `record_agent_job_step` |
| `approval_requests` | 人工批准（`kind=approval`，绑定 `target_type / target_id / target_revision`）和 Agent 提问（`kind=question`） | 只读；写只能经 RPC | 只能经 RPC 创建 pending |
| ~~`decision_memories`~~（MVP 不做，DB-D11） | 人工决定记忆；`platform` / `content_kind` 为空表示全局 | `content.manage` 可写 | 只读 |
| ~~`knowledge_entries`~~（MVP 不做，worker 读 `knowledge-base/` 文件） | 知识原文 Markdown + `trust_level` | 可写；设为 `trusted` 需要 `content.review` | 只读 |
| ~~`content_ai_proposals`~~（DB2c-3 已退役） | 原先存放 AI 草案；现改为 `write_document_draft(base_revision)` 直接写 `content_documents` | 读 `content_documents`；经 `enqueue_agent_job` 入队 | 经 `node_write_document_draft` 写草稿 |

**任务状态机**：

```text
queued → running → pending_review → succeeded | cancelled | failed
running → blocked_needs_human → (resume) → queued
running → 租约过期 / 可重试失败 → queued
```

终态不可再改（只允许记录 `notified_at`）；任务的身份、输入、目标和所属事项不可修改，只有 `resume_agent_job` 能调高 `payload.limits`。任务状态变化同步事项卡片：排队 / 运行 → `doing`，待审核 → `review`，等人 / 失败 → `waiting`；`done` / `dropped` 的卡和 Chat 回合不动。

## 3. RPC

| 函数 | 调用方 | 说明 |
| --- | --- | --- |
| `enqueue_agent_job` | 登录用户（`agent.dispatch`） | 幂等；`content_draft` 还会校验稿件版本 |
| `cancel_agent_job` / `resume_agent_job` | 登录用户 | 运行中的任务只设置取消标志；恢复只适用于 blocked 状态 |
| `claim_agent_job(kinds, lease)` | worker | 先回收过期租约，再按 `run_after, created_at` 用 `FOR UPDATE SKIP LOCKED` 取一条；同一事项已有运行中的非 Chat 任务时跳过；`lease_epoch + 1` 并返回 |
| `heartbeat_agent_job` / `complete_agent_job` / `fail_agent_job` / `record_agent_job_step` | worker | 都要带认领时拿到的 `lease_epoch`，不等于当前值就拒绝（旧进程的迟到写入）；只有标记为可重试且还有次数才重新排队 |
| `list_pending_notices` / `mark_notice_sent` | worker | 通知轮询：列出需要人处理且 `notified_at` 为空的任务、批准、提问；发送成功才标记 |
| `create_approval_request` | 登录用户或 worker | 同一对象同一版本只保留一条 pending |
| `decide_approval_request` | **只限登录的人** | worker（`service_role`）没有执行权限 |
| `ask_question(job, question, lease_epoch)` | **只限 worker** | Agent 拿不准时提问：写一条 `kind=question` 的请求，任务转为 `blocked_needs_human` |
| `answer_question` | **只限登录的人**（`content.manage`） | 回答后，提问的任务自动重新排队 |

## 4. Mandate 门禁（数据库强制）

- 受门禁的任务类型：`publish_external`、`publish_site`、`video_render`，以及视频工坊中按服务端估算需要付费的任务。它们必须带有已批准、未过期、动作和对象一致、版本等于对象当前版本的批准记录，触发器 `agent_job_mandate` 才放行。
- 稿件或视频计划的版本一变，旧版本上的 pending / approved 批准自动变为 `expired`。
- 前端的 `checkMandateGate` 只用于界面提示，不是门禁。

## 5. 一次运行的循环

每一轮：`generate`（1 跳）→ `precheck`（确定性检查，0 跳；不通过就直接重写）→ `evaluate`（独立 LLM，1 跳）。

- 上限在 `payload.limits`：`max_rounds`（默认 3）、`max_hops`、`budget_cents`、`token_budget`，由 worker 的循环控制器检查（DB2c-1 起不再由数据库列检查，见 database.md §4.4）。超限进入 `blocked_needs_human`。
- 进度（轮次、跳数、费用、Token、模型）由已落库的步骤推导，所以中断后恢复时，已经完成的计费调用不会重做。**已计费的失败不自动重试。**
- 确定性预检：防注入泄漏、篇幅、禁用表述、平台格式。
- LLM 评估：输出严格 JSON 清单并做 schema 校验；`fact_grounding` 判通过却没有引用任何有效 source_id 时，按不通过处理。
- Context Pack：system 区只放规则、SOP、匹配的决定记忆（默认 20 条）和 `trusted` 知识；外部信源和未审核知识放进 `<untrusted_*>` 标签，标签字符在数据中转义。注入检测只用作审计信号，真正的防线是权限和 schema 校验。
- 驱动：云端走 OpenAI 兼容协议（生成器 `SENSE_LLM_*`，评估器 `SENSE_EVAL_LLM_*`，建议用不同厂商）；CLI 只接通了 `codex exec`（prompt 走 stdin，环境变量白名单，只读沙箱，**从未真实调用过**）。

## 6. 0.5 调整方向

1. 循环拆成两层：`workers/agent/loop` 定义通用的会话、回合、停止条件和接口；harness 是其中一种「生成 → 预检 → 评估」形状的循环（architecture 6.3）。执行面同时有 HTTP 与队列两个入口，共用同一套 handler（architecture 6.5）。
2. 执行模式分为 `harness / agent_session / chat / video`。`agent_session` 为每个事项开一个可写目录，凭证不进子进程。
3. ~~worker 改用受限的节点身份~~（DB2c-2 已完成）：agent worker 用控制台签发的节点令牌 + 公开 key 调 `node_*` RPC，不再持有 `service_role`；吊销即失效，只能认领本组织任务、只能写自己持有的任务（database.md 4.4、DB-D16）。视频 worker 留到 DB5。`lease_epoch` 已在 DB2c-1 加入，拒绝旧进程的迟到写入。
4. 所有 CLI 调用都收进 `workers/agent/drivers`，删除 Vite 里的 spawn。
5. 知识库：`knowledge-base/**/*.md` 由 worker 直接读取（`workers/agent/knowledge.ts`，全部视为可信，经 git 审阅）；`npm run kb:seed` 只生成控制台只读展示用的常量，测试会校验同步。知识表与决定记忆表已在最终批次删除。
