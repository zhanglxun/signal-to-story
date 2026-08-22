# Edge Functions

仅在浏览器不能安全执行的场景使用，例如账号管理、第三方密钥调用、Webhook 签名验证或需要受信任权限的 Agent 回调。

## `admin-create-account`

- 要求有效 Supabase 用户 JWT。
- 从 `organization_roles` 校验调用者具备 `account.manage`，并满足目标角色的分配权限。
- 只有 `owner` 可以创建另一个 `owner`。
- 服务端调用 Auth Admin API 并自动确认邮箱，不走验证码流程。
- 同步建立 `profiles`、`organization_members` 和 `audit_events`；任一步失败会删除刚创建的 Auth 用户进行补偿。
