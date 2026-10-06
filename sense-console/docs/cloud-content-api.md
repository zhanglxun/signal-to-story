# Cloud Content MVP 数据字典与接口

## 数据来源与版本

在线正文以 `content_documents` 为当前稿件、`content_revisions` 为不可变历史。所有正文变化由数据库触发器生成历史记录并撤销当前审核状态。平台版本显式复制母稿，后续独立编辑，母稿变化不会隐式覆盖已派生内容。

现有 `organizations`、`organization_roles`、`selections`、`assets` 继续使用。所有新增业务表启用组织范围 RLS；浏览器不持有服务端密钥。关联使用组织 ID 与对象 ID 的复合外键，禁止跨组织引用。

## 新增数据表

| 表 | 关键字段与约束 |
| --- | --- |
| content_projects | UUID id；organization_id；可空 selection_id；title 1–160 字；brief ≤20000 字；content_kind=explainer/knowledge/story；target_seconds=1–3600，默认300；aspect_ratio=9:16/16:9/1:1；created_by/created_at/updated_at |
| content_documents | UUID id；project_id；platform=master 或七个平台；title 1–200 字；body ≤100000 字 Markdown；revision 从1递增；status；review_note ≤4000 字；同项目同平台唯一 |
| content_revisions | UUID id；document_id+revision 唯一；完整 title/body 快照；created_by/created_at；客户端只读 |
| content_review_events | document_id+revision；status/note；操作人和时间；客户端只读，由数据库触发器追加 |
| publishing_channels | UUID id；platform；name；可选 profile_url；同组织、平台和账号名称唯一；仅登记人工发布目标，不存 OAuth 令牌 |
| content_publications | UUID id；document_id+revision+channel_id 唯一；scheduled_at；status=planned/published/cancelled；published_url/published_at；已完成记录不可修改 |
| publication_metrics | publication_id；observed_at；views/likes/saves/comments 可空非负整数；retrospective；每个观察时间唯一，快照只追加 |
| content_project_assets | project_id+asset_id 联合主键；关联已有 assets；当前提供追加关联 |
| content_ai_proposals | document_id/input_revision；model/prompt_version/instruction/input_brief；status=running/succeeded/failed；body/error/usage；created_by/created_at/finished_at；客户端只读，受认证的 Edge Function 写入 |

新表具体字段类型、默认值、索引、约束及 RLS 以 `supabase/migrations/20261006111044_cloud_content_mvp.sql` 为准。

## 权限

| 权限 | 操作 |
| --- | --- |
| content.view | 读取所属组织的项目、稿件、历史、审核记录、发布和指标 |
| content.manage | 创建/编辑项目和稿件、提交审核、关联素材、请求 AI 草案 |
| content.review | 对待审核稿件批准或退回，允许自审 |
| content.publish | 登记账号、创建/取消计划、记录人工发布、追加指标 |

迁移为已有 Owner/Admin 追加 review/publish 权限。未来创建新组织时，其初始化角色也必须包含对应权限。成员协作复用现有账号管理；新 UI 根据权限展示动作，数据库再次校验。

## 状态转换

```text
draft / changes_requested → in_review → approved / changes_requested
任意状态下修改正文或标题 → 新 revision + draft

approved 的最新平台版本 + 同平台账号 → planned → published / cancelled
```

提交审核要求正文非空，退回要求理由。审核、发布检查由数据库执行，绕过 UI 仍然生效。已发布记录不可更新。历史版本不可直接更新或删除。

## Data API 契约

前端服务入口：`src/services/content-service.ts`。普通 CRUD 直连 Supabase Data API，不新增传统业务服务器。

| 操作 | 请求与返回 |
| --- | --- |
| 创建项目 | POST content_projects：organization_id/title/brief/content_kind/target_seconds/aspect_ratio/selection_id；返回项目 |
| 保存项目 | PATCH content_projects?id=eq.UUID&updated_at=eq.已读取值；返回新项目；零行表示并发冲突 |
| 创建稿件 | POST content_documents：organization_id/project_id/platform/title/body；返回 draft v1 |
| 保存稿件 | PATCH content_documents?id=eq.UUID&revision=eq.N&status=eq.已读取状态：title/body；返回新稿件；零行表示冲突 |
| 提交/审核 | 同一条件 PATCH：status/review_note；返回新状态，数据库校验权限和状态转换 |
| 读取历史 | GET content_revisions / content_review_events，按 document_id 筛选 |
| 排期 | POST content_publications：organization_id/document_id/revision/channel_id/scheduled_at |
| 记录发布 | PATCH planned 记录：status=published/published_url/published_at |
| 取消排期 | PATCH planned 记录：status=cancelled |
| 追加观察 | POST publication_metrics：organization_id/publication_id/observed_at/可空指标/retrospective |
| 关联资产 | POST content_project_assets：organization_id/project_id/asset_id |

时间使用 ISO 8601 UTC 存储，页面按浏览器时区输入和展示。平台代码：wechat_channels/wechat_official/xiaohongshu/douyin/x/youtube/reddit。未录入指标使用 null。

可预期错误：42501 无权操作；23505 重复记录；P0001 业务状态不允许；乐观更新零行表示稿件已变化；客户端保留编辑输入。SQL 约束错误由服务层转换为用户可读提示。

## AI 草案接口

`POST /functions/v1/content-draft`，Authorization 使用登录用户 JWT，body：

```json
{"document_id":"UUID","instruction":"请改写为面向企业负责人的图文草案"}
```

返回 `{ "proposal_id": "UUID" }`；失败返回 `{ "error": "可读原因" }` 和 4xx/5xx。服务端验证用户身份、组织读权限和 content.manage 后，读取数据库稿件与 Brief。模型结果只写入提案，不能批准或发布。

服务端配置：CONTENT_AI_API_KEY、CONTENT_AI_BASE_URL、CONTENT_AI_MODEL。浏览器不接收这些值。使用 OpenAI 兼容 Chat Completions 协议对接现有文字服务；80 秒调用超时，单次最多5000输出 token，不自动重试计费请求。usage 保留供应商 token 统计，不推算金额。

每稿件同一时间最多一个 running 请求。超过180秒的遗留任务在下次请求时标记失败。前端可查看最近20条提案；过期输入版本的提案只能人工复制合并，不能直接采纳。

## 导出

- 稿件：Markdown，带标题、目标平台与版本号。
- 发布记录：始终导出绑定的不可变 revision，不导出当前已改版的正文。
- 视频交接：JSON `schema_version: 1.0`，包含 project、母稿 script、关联 assets、`rendering: external`。这是制作输入，不表示已经生成视频。

## 后续边界

媒体自动生成、跨平台自动发帖、自动指标采集、拖拽流水线与实时协同编辑未在本轮实现。当前以乐观并发冲突检测支持协作，避免互相覆盖。

## 文字流程交接（2026-10-06）

- `getSignal(id)`：通过 RLS 读取来源详情；立项时 `selectionBrief` 将来源、核查说明、大纲和禁忌一起放入项目 Brief。
- `buildTextHandoff`：只读构建 `mode: rehearsal` 的交接数据，保留稿件 ID、平台、版本、真实审核状态与匹配渠道；不写审批、发布或指标表。
- `textHandoffMarkdown`：同一数据导出为可人工阅读的文字交接包；项目页面也提供可复制预览，内嵌浏览器下载不可用时仍能交接。
- `reviewWindows(actual_published_at)`：计算实际发布后 24 / 48 小时的复盘时间，展示在真实发布记录上；不是自动采集任务。
- 原有数据库验收扩展为信息源 → 选题 → 项目 → X / 公众号独立审核和账号匹配 → 两次模拟观察；所有测试记录事务回滚。
