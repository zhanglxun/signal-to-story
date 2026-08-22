# Supabase workspace

此目录预留给 Supabase CLI 配置、迁移和 Edge Functions。业务表 Schema 将由独立的数据模型设计提交产生，本轮不创建临时表。

- `migrations/`：可审查、可回滚的数据库迁移
- `functions/`：仅放置需要服务端密钥、Webhook 或强校验的 Edge Functions
- `tests/`：RLS 与数据库契约测试

不要提交 `.env.local`、数据库密码或 `service_role` 密钥。
