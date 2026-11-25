# 内容生产：稿件、版本、审核、发布与复盘

> 由旧 `cloud-content-api.md` 精简而来。V1 部分已上线。

## 1. 表（0.5 定版，最终批次后）

| 表 | 要点 |
| --- | --- |
| `content_documents` | 稿件，也是发布记录。挂 `work_item_id`（必填）；`platform` 为 master 或 7 个平台之一，同一事项同一平台唯一；`revision` 只计数（不存历史快照）；`status`；发布列 `published_*` + `slug` 只能由发布 RPC 写 |
| `audit_events` | 审核历史（`content.<status>`）、AI 写稿（`content.ai_draft_written`）、发布 / 下线 / 回填链接（`content.published` / `content.unpublished` / `content.published_url`） |

已退役：`content_projects`、`content_project_assets`、`content_revisions`、`content_review_events`、`content_ai_proposals`、外部发布三表（`publishing_channels` / `content_publications` / `publication_metrics`）。V1 数据在退役迁移里回填到 `work_items` / `audit_events` 并对账后删除。

平台代码：`wechat_channels / wechat_official / xiaohongshu / douyin / x / youtube / reddit`。

## 2. 状态与规则

```text
draft / changes_requested → in_review → approved / changes_requested
任何时候改标题或正文 → 新 revision，状态回到 draft，旧批准失效（已上线的读者站内容不受影响）
approved 的当前版本 + 已批准的 publish_site 请求 → publish_document → 读者站上线；人工外发后回填 published_url
```

- **乐观并发**：更新时带上读取到的 `revision` 和 `status`；更新了 0 行就表示冲突，前端保留用户的输入。
- **平台稿**由母稿显式复制而来，之后独立编辑，母稿改动不会覆盖平台稿。
- **门禁在数据库里**：提交审核要求正文非空，退回要求填理由，审核和发布都由数据库检查。允许有审核权限的作者自审。
- **错误码**：42501 无权限、23505 重复、P0001 状态不允许，由 service 层转换成可读提示。
- **导出**：稿件导出为 Markdown（带版本号）；文字演练包导出 Markdown / JSON。
- **复盘**：不做数据复盘表；需要时人工记录，长期偏好由人写进 `knowledge-base/`。

## 3. AI 草案

- 旧路径（同步 Edge Function `content-draft` 写 `content_ai_proposals`）已在 DB2c-3 下线（传 `mode: "sync"` 返回 `410`）。
- 当前路径（队列 + 直接写草稿）：控制台直接调用 `enqueue_agent_job` RPC 入队（`content-draft` 也仅保留队列模式），由 `workers/agent` 执行循环，通过 `node_write_document_draft(base_revision)` 校验版本后直接写入 `content_documents` 新版本草稿，过程留在 `agent_job_steps`；仍不能批准或发布，人工审核通过后触发器自动将 `pending_review` 任务置为 `succeeded`。见 [harness.md](harness.md)。

## 4. 0.5 调整方向

- ~~稿件挂 `work_item_id`、退役版本快照与审核事件表、发布列并入本表、外部发布三表退役~~（2026-11-26 完成，最终批次 `0.5.0-step5.sql`）。
- 审核和发布的交互放进看板卡片的抽屉里（R4）。
