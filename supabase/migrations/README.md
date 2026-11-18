# Migrations

迁移通过 Supabase CLI 生成，并与远端 `signal-to-story` 项目的迁移历史保持一致。任何远端 Schema 调整都必须同步回写为可审查迁移。

- `20260822144609_create_organization_accounts.sql`：组织、账号资料、成员关系与审计基座。
- `20260822154645_create_organization_roles.sql`：数据库驱动的组织角色、能力集合、分配规则与成员角色外键。
- `20261115100000_agent_jobs_queue.sql`：Agent 任务队列、步骤审计、认领/心跳/完成/失败 RPC、`agent.approve` 能力、`content_ai_proposals.agent_job_id`。
- `20261115100100_decision_memories_knowledge.sql`：决定记忆与知识库表（可信级别、审核者才能标记可信）。
- `20261115100200_approval_requests_mandate.sql`：Mandate 批准请求、人工决定 RPC、版本变更自动失效、受门禁任务类型的数据库强制。
- `20261123100000_agent_jobs_mvp.sql`（DB2c-1，上线第 2 批）：`agent_jobs` 精简到 21 列（目标 / 批准 / 上限进 `payload`，`lease_epoch` 取代 `locked_by`，`work_item_id` 串行与卡片状态同步，`notified_at`），`agent_job_steps` 精简到 10 列（只追加，经 `record_agent_job_step` 写入），`approval_requests.notified_at`，通知轮询 RPC；已有行原地搬迁。
