# Agent 执行：任务队列、循环、Mandate 门禁

> 由旧 `agent-harness.md` 和 `workers/agent/README.md` 精简而来。描述的是 `codex/0.3` 的现状；0.5 的调整方向见第 6 节。

## 1. 组成（现状路径）

| 部分 | 位置 | 0.5 位置 |
| --- | --- | --- |
| 契约 | `sense-console/src/contracts/agent-*.ts` | `core/contracts` |
| 循环纯函数 | `sense-console/src/harness/*` | `core/harness`，并新增 `core/agent` |
| worker | `sense-console/workers/agent/*` | `workers/agent` |
| 数据库 | migrations `20261115100000/100100/100200` | `supabase/migrations` |
| 入队入口 | Edge Function `content-draft`（`mode: "queue"`） | 不变 |

## 2. 表

| 表 | 作用 | 浏览器 | worker |
| --- | --- | --- | --- |
| `agent_jobs` | 任务队列：幂等键（组织内唯一）、租约、预算、轮次 / 跳数 | 只读；写只能经 RPC | 经 RPC 认领和完成 |
| `agent_job_steps` | 每一步一行，`unique(job_id, round, step_kind)`，不可修改 | 只读 | 只能插入 |
| `approval_requests` | 人工批准，绑定 `target_type / target_id / target_revision` | 只读；写只能经 RPC | 只能经 RPC 创建 pending |
| `decision_memories` | 人工决定记忆；`platform` / `content_kind` 为空表示全局 | `content.manage` 可写 | 只读 |
| `knowledge_entries` | 知识原文 Markdown + `trust_level` | 可写；设为 `trusted` 需要 `content.review` | 只读 |
| `content_ai_proposals.agent_job_id` | 提案追溯到任务 | 只读 | 写 |

**任务状态机**：

```text
queued → running → pending_review → succeeded | cancelled | failed
running → blocked_needs_human → (resume) → queued
running → 租约过期 / 可重试失败 → queued
```

终态不可再改；任务的身份字段和输入字段不可修改。

## 3. RPC

| 函数 | 调用方 | 说明 |
| --- | --- | --- |
| `enqueue_agent_job` | 登录用户（`agent.dispatch`） | 幂等；`content_draft` 还会校验稿件版本 |
| `cancel_agent_job` / `resume_agent_job` | 登录用户 | 运行中的任务只设置取消标志；恢复只适用于 blocked 状态 |
| `claim_agent_job` | worker | 先回收过期租约，再用 `FOR UPDATE SKIP LOCKED` 取一条 |
| `heartbeat_agent_job` / `complete_agent_job` / `fail_agent_job` | worker | 不是租约持有者时写入失败；只有标记为可重试且还有次数才重新排队 |
| `create_approval_request` | 登录用户或 worker | 同一对象同一版本只保留一条 pending |
| `decide_approval_request` | **只限登录的人** | worker（`service_role`）没有执行权限 |

## 4. Mandate 门禁（数据库强制）

- 受门禁的任务类型：`publish_external`、`publish_site`、`video_render`，以及视频工坊中按服务端估算需要付费的任务。它们必须带有已批准、未过期、动作和对象一致、版本等于对象当前版本的批准记录，触发器 `agent_job_mandate` 才放行。
- 稿件或视频计划的版本一变，旧版本上的 pending / approved 批准自动变为 `expired`。
- 前端的 `checkMandateGate` 只用于界面提示，不是门禁。

## 5. 一次运行的循环

每一轮：`generate`（1 跳）→ `precheck`（确定性检查，0 跳；不通过就直接重写）→ `evaluate`（独立 LLM，1 跳）。

- 上限：`max_rounds`（默认 3）、`max_hops`、`budget_cents`、`token_budget`。超限进入 `blocked_needs_human`。
- 进度由已落库的步骤推导，所以中断后恢复时，已经完成的计费调用不会重做。**已计费的失败不自动重试。**
- 确定性预检：防注入泄漏、篇幅、禁用表述、平台格式。
- LLM 评估：输出严格 JSON 清单并做 schema 校验；`fact_grounding` 判通过却没有引用任何有效 source_id 时，按不通过处理。
- Context Pack：system 区只放规则、SOP、匹配的决定记忆（默认 20 条）和 `trusted` 知识；外部信源和未审核知识放进 `<untrusted_*>` 标签，标签字符在数据中转义。注入检测只用作审计信号，真正的防线是权限和 schema 校验。
- 驱动：云端走 OpenAI 兼容协议（生成器 `SENSE_LLM_*`，评估器 `SENSE_EVAL_LLM_*`，建议用不同厂商）；CLI 只接通了 `codex exec`（prompt 走 stdin，环境变量白名单，只读沙箱，**从未真实调用过**）。

## 6. 0.5 调整方向

1. 循环拆成两层：`core/agent` 定义通用的会话、回合、停止条件和接口；harness 是其中一种「生成 → 预检 → 评估」形状的循环（architecture 6.3）。
2. 执行模式分为 `harness / agent_session / chat / video`。`agent_session` 为每个事项开一个可写目录，凭证不进子进程。
3. worker 改用受限的节点身份（`runner_nodes`），并加入 `lease_epoch`，拒绝旧进程的迟到写入。
4. 所有 CLI 调用都收进 `workers/agent/drivers`，删除 Vite 里的 spawn。
5. 知识库种子：`knowledge-base/**/*.md` → `npm run kb:seed` 生成前端常量和 `supabase/seeds/knowledge_base.sql`，测试会校验两者同步。
