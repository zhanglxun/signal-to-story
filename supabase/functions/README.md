# Edge Functions

仅在浏览器不能安全执行的场景使用，例如账号管理、第三方密钥调用、Webhook 签名验证或需要受信任权限的 Agent 回调。

## `admin-create-account`

- 要求有效 Supabase 用户 JWT。
- 从 `organization_roles` 校验调用者具备 `account.manage`，并满足目标角色的分配权限。
- 只有 `owner` 可以创建另一个 `owner`。
- 服务端调用 Auth Admin API 并自动确认邮箱，不走验证码流程。
- 同步建立 `profiles`、`organization_members` 和 `audit_events`；任一步失败会删除刚创建的 Auth 用户进行补偿。

## `qiniu-upload-token`

- 要求有效 Supabase 用户 JWT 与目标组织的 `content.manage` 权限。
- 从 Edge Function Secrets 读取 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`、`QINIU_BUCKET`、`QINIU_PREFIX` 与 `QINIU_UPLOAD_HOST`；浏览器永不读取长期密钥。
- 为单个组织、单个对象键签发五分钟有效的七牛上传凭证；提示词图例对象键采用 `signal-story/prompts/{uuid}.{ext}`。

## `storage-upload-token`

- 公共对象存储凭证入口；目前适配七牛，后续 OSS、COS、R2 复用此入口。
- 请求只能传受服务端白名单约束的 `purpose`，而不是任意对象路径；当前 `prompt_example → signal-story/prompts/`。

## `content-draft`

- 要求有效用户 JWT 与目标组织的 `content.manage` + `agent.dispatch` 权限。
- 仅保留队列模式（同步写 `content_ai_proposals` 已在 DB2c-3 下线，显式传 `mode: "sync"` 返回 `410`）：以调用者身份调用 `enqueue_agent_job` 写入幂等的 `agent_jobs`（`content_draft`），立即返回 `job_id`；由 `workers/agent` 执行生成—评估循环并通过 `node_write_document_draft` 直接写回草稿新版本。详见仓库根目录 `docs/modules/harness.md`。
