# Migrations

迁移通过 Supabase CLI 生成，并与远端 `signal-to-story` 项目的迁移历史保持一致。任何远端 Schema 调整都必须同步回写为可审查迁移。

- `20260822144609_create_organization_accounts.sql`：组织、账号资料、成员关系与审计基座。
- `20260822154645_create_organization_roles.sql`：数据库驱动的组织角色、能力集合、分配规则与成员角色外键。
