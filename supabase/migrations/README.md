# Migrations

迁移通过 Supabase CLI 生成，并与远端 `signal-to-story` 项目的迁移历史保持一致。任何远端 Schema 调整都必须同步回写为可审查迁移。

- `20260822144609_create_organization_accounts.sql`：组织、账号资料、成员关系与审计基座。
- `20260822154645_create_organization_roles.sql`：数据库驱动的组织角色、能力集合、分配规则与成员角色外键。
- `20261115100000_agent_jobs_queue.sql`：Agent 任务队列、步骤审计、认领/心跳/完成/失败 RPC、`agent.approve` 能力、`content_ai_proposals.agent_job_id`。
- `20261115100100_decision_memories_knowledge.sql`：决定记忆与知识库表（可信级别、审核者才能标记可信）。
- `20261115100200_approval_requests_mandate.sql`：Mandate 批准请求、人工决定 RPC、版本变更自动失效、受门禁任务类型的数据库强制。
- `20261123100000_agent_jobs_mvp.sql`（DB2c-1，上线第 2 批）：`agent_jobs` 精简到 21 列（目标 / 批准 / 上限进 `payload`，`lease_epoch` 取代 `locked_by`，`work_item_id` 串行与卡片状态同步，`notified_at`），`agent_job_steps` 精简到 10 列（只追加，经 `record_agent_job_step` 写入），`approval_requests.notified_at`，通知轮询 RPC；已有行原地搬迁。
- `20261124100000_runner_nodes.sql`（DB2c-2，上线第 3 批）：`runner_nodes`（令牌只存哈希）、`agent_jobs.node_id` 外键、`create_runner_node` / `revoke_runner_node`，以及 worker 用公开 key + 节点令牌调用的 12 个 `node_*` RPC（DB-D16）。纯新增。
- `20261127100000_chat_runtime_catalog.sql`（DB3b，上线第 6 批）：Chat 回合串行 / 幂等 / `reply_to_message_id`、`chat_messages.parts / status`、`chat_sessions.runtime_config`、`send_chat_message` 扩参与 `regenerate_chat_turn`、`node_chat_context`、`node_append_chat_message`（`p_parts / p_status / p_finish / p_title`）、`runner_nodes.capabilities` 与 `node_report_capabilities`、`node_claim` 按 `target_node_id` 过滤、`node_claim_job`、未认领回合 10 分钟过期、`chat_messages` 加入 Realtime 发布。
