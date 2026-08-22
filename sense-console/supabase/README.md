# Supabase workspace

此目录保存 Supabase CLI 配置、迁移和 Edge Functions。组织与账号基座已经落地；内容生产业务表 Schema 仍由独立的数据模型设计提交产生。

- `migrations/`：可审查、可回滚的数据库迁移
- `functions/`：仅放置需要服务端密钥、Webhook 或强校验的 Edge Functions
- `tests/`：RLS 与数据库契约测试

当前远端项目：`signal-to-story`（project ref：`ryhdcdljryllgkekfjan`）。

`organization_roles` 保存组织角色、能力集合与分配规则；默认四个角色通过迁移初始化。`admin-create-account` 是受 JWT 和角色权限共同保护的高权限函数，用于后台创建已确认的邮箱密码账号。普通 CRUD 仍由浏览器通过 Data API 与 RLS 完成。

不要提交 `.env.local`、数据库密码或 `service_role` 密钥。
