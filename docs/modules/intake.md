# 资讯收集：收录网关、Web 速记、飞书/企微

> 由旧 `external-intake.md`、`quick-capture.md`、`im-channels.md` 精简而来。描述的是 `codex/0.3` 的现状；0.5 的调整方向见第 5 节。

## 1. 三个入口（现状）

| 入口 | 位置 | 身份 | 状态 |
| --- | --- | --- | --- |
| 外部收录 | Edge Function `intake-gateway`，`Bearer stk_…` 令牌 | 令牌绑定的连接创建人 | **线上可用**（只有 capture） |
| Web 速记 | 顶栏「速记」/ `Cmd+K` / `/capture` 页 → RPC `quick_capture` | 登录用户 | 本地完成，未上线 |
| 飞书 / 企微 | Edge Function `im-webhook/<feishu\|wecom>/<connection_id>` | 平台签名 + 路径中的连接 id | 本地完成，未联调 |

三个入口最终都写入：`signals`（信源）→ `selections`（候选选题），`auto_draft` 时继续写 `content_projects` → 稿件 → `agent_jobs`。

## 2. 意图约定（Web 和 IM 通用）

- **`capture_only`**（裸链接、「收藏」）：只建信源和候选选题，不触发出稿。
- **`auto_draft`**（「出稿 / 写一篇 / 写成 X 和公众号」）：在同一事务里依次立项、建母稿和平台稿、每篇稿件入队一个 `content_draft` 任务。任一步失败整体回滚。
- **「补充到 #任务号」、审核词（「通过」「发布」）**：只回复提示，不执行。消息正文一律作为不可信数据入库。

## 3. 关键规则

- **幂等**：Web 端每次提交生成 `web-<uuid>`，重试复用；连接通道的键是 `conn:<connection_id>:<external_id>`。同键同内容返回原结果（`duplicate: true`），同键不同内容返回 409 / `idempotency_conflict`。
- **限流**：每个连接每小时 100 条；浏览器每个用户每小时 120 条。
- **令牌**：数据库只存 SHA-256 摘要，有效期 30 天；创建人失去 `content.manage` 后立即失效。
- **服务端通道的身份**：仅在本次调用内把 `jwt.sub` 设为连接创建人，`role` 保持 `service_role`，所以仅限人做的动作（批准）依然不可用。
- **抓取正文**（worker，`fetch_source=true`）：只允许 http/https 默认端口；解析出的每个地址都必须是公网地址，并在 socket lookup 时再校验一次，防止 DNS rebinding；重定向最多跟随 3 次，每跳复检；上限 2MB、10 秒、12000 字。抓取失败时只用用户备注继续出稿。
- **IM 回执与收录分开**：收录的暂时性失败返回 503，让平台重试；回执发送失败只记日志。卡片只有两个跳转链接，不能在 IM 里批准。

## 4. 协议与密钥

- **收录 API v1**：`POST`，body 为 `{version:1, intent:"capture"|"auto_draft", external_id(1–128), text(1–4000), title?, url?, angle?, platforms?}`，大小不超过 24KB；成功返回 `receipt_id / signal_id / selection_id / duplicate / topic_path`。
- **IM Secret**（只放 Edge Function 和 worker）：`FEISHU_VERIFICATION_TOKEN`、`FEISHU_ENCRYPT_KEY`、`FEISHU_APP_ID/SECRET`、`WECOM_BOT_TOKEN`、`WECOM_ENCODING_AES_KEY`、`WECOM_NOTIFY_WEBHOOK_URL`、`CONSOLE_BASE_URL`。目前一套 Secret 只对应一个飞书应用和一个企微机器人。
- **已对照官方文档**：飞书加解密与签名、企微智能机器人回调字段。**未对照**：飞书 url_verification、事件信封、卡片 JSON、发消息接口；企微签名算法、群机器人 markdown 格式。联调时很可能要改。
- **Dot（手机端）**：从未验收。凭证的安全交付机制没有建立。

## 5. 0.5 调整方向

1. **统一入口层**：所有入口只做一件事，调用 `record_trigger` 写一条不可变的 `triggers` 记录（来源、来源内事件 id、来源内身份、内容、回复地址）。`signals / selections / intake_receipts / quick_captures` 合并或退役，表设计在 R5 确认。
2. **起点授权**按来源允许名单判断，首版只有本人；名单之外的来源只产生「推断」类 trigger，进收件箱，不自动出稿。
3. ~~IM 适配器只保留一份~~（R1 已完成：`supabase/functions/_shared/im`，`im-webhook` 与 `workers/agent/notify` 都引用它）。待审通知改走 outbox 投递，只在待审核、待答复、受阻三种情况推送。
4. 定时发现选题先用影子模式：只记录建议，不立项。
