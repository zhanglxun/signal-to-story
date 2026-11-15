# Agent Harness 内核（P1.5）

后续 P3～P7（速记出稿、IM、视频工坊、发布、读者站）都基于这里的表、RPC 与接口。改动它们需要同步本文件和测试。

## 1. 组件与代码位置

| 层 | 位置 | 运行环境 |
| --- | --- | --- |
| 契约（浏览器） | `src/contracts/agent-job.ts`、`src/contracts/agent-harness.ts`、`src/contracts/knowledge-base.ts` | Web |
| 前端 service | `src/services/agent-job-service.ts`、`src/services/knowledge-base-service.ts` | Web |
| Harness 核心（纯 TS，无浏览器/Node 专属 API） | `src/harness/*`（`@/harness`；兼容入口 `@/services/agent-harness-service`） | Web + Worker |
| Worker | `workers/agent/*`（相对路径引用 `src/harness`，`tsconfig.worker.json` 类型检查） | Node 22 |
| 数据库 | `supabase/migrations/20261115100000_*`、`…100100_*`、`…100200_*` | Postgres |
| 入队入口 | `supabase/functions/content-draft`（`mode: "queue"`） | Edge Function |

## 2. 表

| 表 | 作用 | 浏览器 | worker (service_role) |
| --- | --- | --- | --- |
| `agent_jobs` | 任务队列（幂等键 org 内唯一、租约、预算、轮次/跳数） | 读（`content.view`）；写只能经 RPC | select/insert/update（受状态机触发器约束） |
| `agent_job_steps` | 每步一行，`unique(job_id, round, step_kind)`，不可修改 | 读 | select/insert |
| `decision_memories` | 人工决定记忆；`platform`/`content_kind` 为空 = 全局 | 读；`content.manage` 写 | **只读** |
| `knowledge_entries` | 知识库原文 Markdown；`trust_level` | 读；`content.manage` 写；设 `trusted` 需 `content.review` | **只读** |
| `approval_requests` | Mandate 批准请求，绑定 `target_type/target_id/target_revision` | 读；写只能经 RPC | 读；只能经 RPC 创建 pending |
| `content_ai_proposals.agent_job_id` | 新增列：提案追溯到任务（每任务最多一条） | 读 | 写 |

新增权限能力 `agent.approve`（迁移授予 owner/admin），用于付费渲染、删除项目类批准。

### 2.1 `agent_jobs.status` 状态机

```text
queued ──claim──▶ running ──▶ pending_review ──▶ succeeded | cancelled | failed
  │                 │  ├──▶ blocked_needs_human ──resume──▶ queued
  │                 │  ├──▶ succeeded | failed | cancelled
  │                 │  └──lease 过期 / 可重试失败──▶ queued
  ├──▶ cancelled / failed
  └──▶ blocked_needs_human（Mandate 批准失效时由触发器停放）
```

- 终态：`succeeded` / `failed` / `cancelled`，不可再改。非终态允许同状态更新（心跳、进度、优先级）。
- 任务身份与输入（`organization_id/job_type/idempotency_key/payload/target_*/created_by`）不可修改。
- `pending_review` 表示提案已落库等待人工；`blocked_needs_human` 表示达到轮次/跳数/预算上限、评估一直不过或批准失效。

### 2.2 Mandate（数据库强制）

- 受门禁的任务类型：`publish_external`、`publish_site`、`video_render`（→ `paid_video_render`）。触发器 `agent_job_mandate`：这些任务要进入 `queued/running/succeeded`，必须带 `approval_request_id`，且该请求 `approved`、未过期、动作/对象一致、`target_revision` 等于对象当前版本。插入时不满足直接拒绝（对 service_role 同样生效）；排队后失效则在认领时被停放为 `blocked_needs_human`（`error_code=mandate_invalid`），不会中断 worker 的认领事务。
- **视频工坊（P5，`20261120100100_video_studio_mandate.sql`）**：`video_tts_preview` / `video_shot_render` / `video_compose` 按**服务端估算**（从当前镜头计算，不信任 payload）决定是否门禁：会调用云端视频模型，或估算 > 10 分（`private.video_cost_rate('free_threshold')`）→ 需要 `paid_video_render` 批准（目标 `video_plan` / 计划 id / 计划 revision，决定人需 `agent.approve`）；本地 Ken Burns 预览与 Edge TTS 试听为 0 成本，免批准。同一批准下所有任务的估算合计不得超过批准额度。计划 revision 变化使旧批准失效；排队中的视频任务在认领时若版本已变直接 `failed`（`stale_target`）。详见 [workers/video/README.md](../workers/video/README.md)。
- 稿件版本变化（`content_documents.revision` 递增）时，触发器把该稿件及其发布计划上 `pending/approved` 的旧版本请求置为 `expired`。
- `decide_approval_request` 只允许登录的人类成员（`auth.role()='authenticated'`），并按动作检查能力：发布类 `content.publish`，付费渲染/删除 `agent.approve`，凭证/权限 `account.manage`。`service_role` 无 EXECUTE 权限，也没有表的 UPDATE 权限。
- 现有 `content_publications` 已具备等价的人类门禁（需稿件 `approved` 且版本一致，写入必须有 `auth.uid()`，service_role 无法写），**原流程复用不变**；新的发布 worker（P6）应走 `publish_external` 任务 + 批准请求。

## 3. RPC

| 函数 | 调用方 | 说明 |
| --- | --- | --- |
| `enqueue_agent_job(org, job_type, idempotency_key, payload, target_type, target_id, target_revision, budget_cents, max_rounds, approval_request_id) → agent_jobs` | authenticated（`agent.dispatch`；`content_draft` 还需 `content.manage` 且稿件版本匹配） | 幂等：同键返回已存在任务；写审计 |
| `cancel_agent_job(job_id)` | authenticated（`agent.dispatch`） | running 任务只设 `cancel_requested_at`，worker 在步骤边界停止 |
| `resume_agent_job(job_id, extra_rounds 0–2, extra_budget_cents)` | authenticated | 仅 `blocked_needs_human → queued` |
| `claim_agent_job(worker_id, job_types[], lease_seconds 15–3600) → setof agent_jobs` | service_role | 先回收过期租约（有剩余次数则重排，否则 failed），再 `FOR UPDATE SKIP LOCKED` 取一条 |
| `heartbeat_agent_job(job_id, worker_id, lease_seconds) → {ok, cancel_requested}` | service_role | 非租约持有者返回 ok=false |
| `complete_agent_job(job_id, worker_id, status, result, error, error_code)` | service_role | status ∈ pending_review/blocked_needs_human/succeeded/failed/cancelled |
| `fail_agent_job(job_id, worker_id, error, retryable, retry_delay_seconds, error_code)` | service_role | 只有 `retryable` 且还有次数才重排 |
| `create_approval_request(org, action, target_type, target_id, target_revision, summary, payload, estimated_cost_cents, requested_by_job)` | authenticated（`content.manage`）或 service_role（必须关联本组织任务） | 同对象同版本只保留一条 pending |
| `decide_approval_request(request_id, 'approved'|'rejected', reason)` | 仅 authenticated 人类 | 过期/版本已变 → 置 expired 并返回 |

## 4. Harness 接口（`src/harness`）

```ts
interface LlmClient { driver: string; model: string; complete(req: LlmRequest): Promise<LlmResponse> }
// LlmCallError { code, retryable, billable } — billable 的失败永不自动重试
interface JobStore {               // worker: createJobStore(backend); 测试: InMemoryJobStore
  listSteps(jobId); recordStep(step)            // (jobId, round, stepKind) 幂等
  updateProgress(jobId, {rounds, hopsUsed, costCents, tokensUsed})
  heartbeat(jobId) → {ok, cancelRequested}      // ok=false → LeaseLostError，停止且不写
  saveProposal(input) → {proposalId}            // 每任务一条 content_ai_proposals
  finish(jobId, {status, result, error, errorCode})
}
runHarnessJob({ job, store, context, generator, evaluator, checklist?, signal?, onEvent? }) → HarnessRunOutcome
```

每轮：`generate`（1 跳）→ `precheck`（确定性，0 跳；不过则跳过 LLM 评估直接重写）→ `evaluate`（独立 LLM，1 跳）。进度（轮次、跳数、成本、tokens）从已落库步骤推导，所以从中断处恢复时已完成的计费调用不会重做。上限：`max_rounds`（默认 3，≤5）、`max_hops`、`budget_cents`（成本 > 0 且达到预算时停）、`token_budget`。

- **确定性预检** `runDeterministicPrecheck`：`no_injection_leak`、`substance`（仅篇幅，≠ 事实核查）、`style_compliance`（禁用表述）、`platform_fit`。
- **LLM 评估器** `runLlmEvaluation`：输入草稿 + 信源 + 清单，要求严格 JSON `{criteria:[{key, passed, feedback, source_ids}]}`，zod 校验；JSON/Schema 错误或缺少清单项 = 该轮评估失败（计入轮次）；`fact_grounding` 判通过却没引用任何有效 `source_id` 时按未通过处理。生成器与评估器分别配置（`SENSE_LLM_*` / `SENSE_EVAL_LLM_*`），建议不同厂商。
- **Context Pack** `buildSafeContextPack`：system 区只有 harness 规则、SOP、按 scope 过滤的决定记忆（active、未过期、平台/内容形式匹配，按时间倒序，默认 20 条）与 `trusted` 知识；外部信源和 `unreviewed` 知识放在 `<untrusted_source_data>` / `<untrusted_reference_knowledge>` 中，所有区块标签在数据里被转义。
- **注入检测只是告警信号**（`detectInjectionSignals`，写进 context 步骤供审计）。真正的防线是：Agent/worker 没有正式内容的写权限、所有模型输出过 Schema 校验、发布/付费动作由数据库门禁拦截。
- 浏览器侧 `checkMandateGate` 仅用于界面提示，权威判断在数据库。

## 5. 前端 service（给 UI 工程师）

`src/services/agent-job-service.ts`：`enqueueContentDraftJob({documentId, instruction, idempotencyKey?})`、`getAgentJob`、`listAgentJobs({organizationId, statuses, jobType, targetId})`、`listAgentJobSteps`、`cancelAgentJob`、`resumeAgentJob`、`listApprovalRequests`、`createApprovalRequest`、`decideApprovalRequest`。`HUMAN_ATTENTION_STATUSES` 用于“等我处理”视图。

`src/services/knowledge-base-service.ts`：`listKnowledgeEntries`、`importKnowledgeMarkdown`（存原文，`unreviewed`）、`setKnowledgeTrustLevel`；渲染统一用 `src/lib/safe-markdown.ts` 的 `renderSafeMarkdown`（markdown-it，`html:false`）。

## 6. content-draft Edge Function

- 请求体 `{ document_id, instruction, mode?: "queue" | "sync", idempotency_key? }`。
- `mode` 缺省时由 `CONTENT_DRAFT_DEFAULT_MODE`（默认 `sync`）决定；现有前端不传 `mode`，行为不变。
- queue：用调用者 JWT 调 `enqueue_agent_job`（RPC 内再次校验权限与稿件版本），默认幂等键 `content_draft:<doc>:r<revision>:<sha256(instruction)[0:16]>`，返回 `202 { job_id, status, duplicate }`（重复请求 200）。

## 7. 知识库种子

仓库 `knowledge-base/**/*.md` 是默认种子：`npm run kb:seed` 生成 `src/data/knowledge-base-defaults.generated.ts`（`BUILTIN_KNOWLEDGE_BASE_ENTRIES`）与 `supabase/seeds/knowledge_base.sql`（为每个组织插入 `trusted` 条目，已存在的 slug 不覆盖；已加入 `config.toml` 的 `db.seed.sql_paths`）。测试会校验生成文件与 Markdown 同步。线上环境需手动在 SQL Editor 执行该 seed。
