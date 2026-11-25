# 数据基座：组织、权限、资产、对象存储

> 由旧 `supabase-data-model.md` 精简而来。各业务表写在对应的模块文档里；0.5 的表归属在 R5 阶段按模块重新确认（见 [architecture.md](../architecture.md) 第 5 节）。

## 1. 组织与权限（已有，线上）

| 表 | 用途 |
| --- | --- |
| `organizations` | 组织 |
| `profiles` | 用户展示资料；本人只能改显示名称 |
| `organization_members` | 用户 ↔ 组织 ↔ 角色 |
| `organization_roles` | 角色和能力集合；默认 owner / admin / member / viewer |
| `audit_events` | 高权限动作审计 |

- **能力**：`content.view / manage / review / publish`、`agent.dispatch`、`agent.approve`、`account.manage`。RLS 和 RPC 都按能力判断，不按角色名判断。
- 授权只以 `organization_members` + `organization_roles` 为准，不信任 `user_metadata`。
- 创建账号经 `admin-create-account` Edge Function（服务端调用 Admin API）。

## 2. 资产账本 `assets`（已有，线上）

资产元数据的索引，供浏览器、Agent 和 worker 共用，不存二进制。

- 关键字段：`asset_type`（character / scene / prop / sound / style，视频 worker 另用 video_studio）、`category`、`cloud_url`、`local_path`（设备路径，不对 Web 开放）、`media_type`、`thumbnail_url`、`metadata jsonb`、`is_active`。
- `content.view` 可读，`content.manage` 可增改；浏览器没有 DELETE 权限，停用用 `is_active=false`。

## 3. 对象存储

- 默认使用 Supabase Storage 私有桶；候选还有阿里云 OSS、腾讯云 COS、七牛、Cloudflare R2。
- 长期密钥只放在 Edge Function（`storage-upload-token`、`qiniu-upload-token`）中，由它们签发临时上传凭证。
- 前端上传统一走 `uploadManagedImage()`（`object-storage-service.ts`），按业务用途映射到固定目录。
- 表里只存稳定的对象定位（Supabase 对象 key 或 `qiniu://bucket/key`），不存签名 URL；读取时按权限临时签发。
- 0.5 计划：这部分抽成 `StorageAdapter` 接口（见 architecture 第 7 节）。

## 4. 通用约定

- 业务表都有 `organization_id`。关联用 `(organization_id, id)` 复合外键，数据库层就能拒绝跨组织引用。
- 审计字段由 `private.set_audit_fields()` 触发器维护。
- 时间用 `timestamptz`，统一 UTC。
- 不用魔法数字：状态用 text + check，或用 boolean。

## 5. Supabase 安全清单（每新增表、视图、RPC、bucket、函数时逐项核对）

- [ ] 表启用 RLS，并为 SELECT / INSERT / UPDATE / DELETE 分别写最小权限策略；UPDATE 同时写 USING 和 WITH CHECK。
- [ ] 显式 GRANT 给 `authenticated`（公开只读的场景才给 `anon`），不依赖默认权限。
- [ ] 视图使用 `security_invoker = true`。`SECURITY DEFINER` 函数固定 `search_path`，函数体内校验调用者，并撤销 PUBLIC 的 EXECUTE 权限。
- [ ] 非公开素材放私有 bucket，读取时签发短时 URL。
- [ ] 浏览器和 `VITE_*` 变量里没有 `service_role`、数据库密码、存储长期密钥或模型 / IM 密钥。
- [ ] Webhook 类函数设置 `verify_jwt = false`，并在入口校验平台签名或令牌。
- [ ] migration 附带 PGlite 测试：跨组织隔离、权限边界、幂等。
