# 内容生产：稿件、版本、审核、发布与复盘

> 由旧 `cloud-content-api.md` 精简而来。V1 部分已上线。

## 1. 表（已有，线上）

| 表 | 要点 |
| --- | --- |
| `content_projects` | 立项与 Brief；`content_kind` 为 explainer / knowledge / story；`target_seconds`；`aspect_ratio`；可空的 `selection_id` |
| `content_documents` | 当前稿件；`platform` 为 master 或 7 个平台之一，同一项目同一平台唯一；`revision` 从 1 递增；`status` |
| `content_revisions` | 不可变的全文快照，由触发器生成，客户端只读 |
| `content_review_events` | 审核事实，由触发器追加，客户端只读 |
| `content_ai_proposals` | AI 输出；采纳后才生成新版本；客户端只读 |
| `publishing_channels` | 人工登记的发布账号（不存 OAuth 令牌） |
| `content_publications` | 绑定 `document_id + revision + channel_id`；planned → published / cancelled；已完成的记录不可修改 |
| `publication_metrics` | 观察快照，只追加；未知指标填 null |
| `content_project_assets` | 项目 ↔ 资产 |

平台代码：`wechat_channels / wechat_official / xiaohongshu / douyin / x / youtube / reddit`。

## 2. 状态与规则

```text
draft / changes_requested → in_review → approved / changes_requested
任何时候改标题或正文 → 新 revision，状态回到 draft，旧批准和旧排期失效
approved 的最新版本 + 同平台账号 → planned → published / cancelled
```

- **乐观并发**：更新时带上读取到的 `revision` 和 `status`（项目带 `updated_at`）；更新了 0 行就表示冲突，前端保留用户的输入。
- **平台稿**由母稿显式复制而来，之后独立编辑，母稿改动不会覆盖平台稿。
- **门禁在数据库里**：提交审核要求正文非空，退回要求填理由，审核和发布都由数据库检查。允许有审核权限的作者自审。
- **错误码**：42501 无权限、23505 重复、P0001 状态不允许，由 service 层转换成可读提示。
- **导出**：稿件导出为 Markdown（带版本号）；发布记录总是导出所绑定的版本；视频交接导出 JSON（`schema_version 1.0`，`rendering: external`）。
- **复盘**：根据实际发布时间计算 24h / 48h 的复盘时间，只做提示，不自动采集指标。

## 3. AI 草案

- 旧路径（同步）：`content-draft` Edge Function 直接调用模型，结果写入提案。
- 新路径（队列，本地完成）：`mode: "queue"` 只入队，由 worker 执行循环（见 [harness.md](harness.md)）。
- 模型输出只能进 `content_ai_proposals`，不能直接改稿件，也不能批准或发布。

## 4. 0.5 调整方向

- 线索、选题、项目合并为看板上的「事项」（`work_items`），稿件挂在 `work_item_id` 下（定版见 [database.md](../database.md) 第 4 节）。
- MVP 不存稿件历史版本（`content_revisions` 退役，`revision` 只作计数器）；审核历史写 `audit_events`；AI 直接写草稿（带 `base_revision` 防覆盖），`content_ai_proposals` 退役。
- 发布信息并入 `content_documents` 的 `published_*` 列；外部平台人工发布后回填 `published_url`，外部发布三表退役。见 [site.md](site.md)。
- 审核和发布的交互放进看板卡片的抽屉里。
