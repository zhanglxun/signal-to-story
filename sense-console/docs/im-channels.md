# IM 通道：飞书机器人 + 企业微信机器人（P4）

迁移：`supabase/migrations/20261121100000_im_channels.sql`。代码：`adapters/im/`（纯 TS，vitest 覆盖）、`supabase/functions/im-webhook/index.ts`（Deno 薄封装）、`workers/agent/notify/im-notify.ts`（待审通知）、`src/components/intake/im-channel-guide.tsx`（配置指引）。

## 数据流

```
飞书/企微 --(签名事件)--> im-webhook --> 验签/解密/握手 --> 解析文本与链接 --> 意图解析
   --> rpc im_quick_capture(connection_id, reply_target, input)  (service_role)
         --> quick_capture_for_connection(token_hash, input)  身份 = 连接创建人
   <-- 回执（飞书：后台回复消息；企微：被动加密 stream 回复）

worker 任务结束(pending_review / blocked_needs_human)
   --> notifyJobNeedsHuman --> rpc im_notify_target(job_id) --> 飞书卡片 / 企微群机器人 Markdown
```

- Webhook 路径：`/functions/v1/im-webhook/<feishu|wecom>/<connection_id>`。连接是 `intake_connections`（`adapter` 现允许 `feishu`/`wecom`）+ `im_channels` 登记行。`im_quick_capture` 校验：已登记、adapter 与通道一致、未撤销、未过期，否则 `invalid_connection`（HTTP 401）。
- 连接内仍有一个 capture-only 令牌摘要（NOT NULL），但 IM 用户永远拿不到令牌；认证靠平台签名 + 路径中的 connection_id。创建时令牌可随机生成并丢弃。
- 幂等：`external_id = <channel>:<平台 message_id>`（超长则哈希），落到 `conn:<connection_id>:<external_id>` 唯一键。重复投递返回 `duplicate:true`，不重复入库、不重复回执。
- 失败分离：收录失败（暂时性）返回 503，让平台重试；回执发送失败只记日志，不重新收录。
- 意图（与 P3 约定一致）：裸链接 / “收藏” → 仅收录；以 `出稿 / 写一篇 / 做这个 / 写成 / 从这个角度写 / 帮我写 / 生成稿件` 开头 → `auto_draft`，并从文字中识别平台（视频号 / 公众号 / 小红书 / 抖音 / X / YouTube / Reddit，未指定则只出母稿）。`补充到 #任务号 / 改一下 #任务号` 与 `通过 / 退回 / 发布…` 等审核词**只回复提示，不执行**。消息正文一律是不可信数据，只作为信源备注入库。
- 卡片按钮只有两个链接：「查看并审核」（`/content/projects/:id`）与「打开任务」（`/tasks/:id`）。飞书 `card.action.trigger` 回调只应答 toast，不做任何批准。

## 部署步骤

1. 应用迁移 `20261121100000_im_channels.sql`。
2. 在控制台「外部接入」或 SQL 创建连接（`adapter='feishu'|'wecom'`，`token_hash` 随机 64 位十六进制），并登记：
   `insert into public.im_channels(connection_id, organization_id, channel) values (...)`（具备 `content.manage` 的成员可经 RLS 插入；adapter 必须与 channel 一致）。
3. 设置 Edge Function Secret（不要写入仓库/浏览器）：
   `supabase secrets set FEISHU_VERIFICATION_TOKEN=… FEISHU_ENCRYPT_KEY=… FEISHU_APP_ID=… FEISHU_APP_SECRET=… WECOM_BOT_TOKEN=… WECOM_ENCODING_AES_KEY=… CONSOLE_BASE_URL=https://story.susense.cn`
4. 部署：`supabase functions deploy im-webhook --no-verify-jwt`（真实性来自平台签名，而非 Supabase JWT）。
5. 平台侧填 Webhook 地址并完成握手（飞书 url_verification；企微 URL 验证 GET）。
6. worker 环境变量（仅需推送待审通知时）：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`WECOM_NOTIFY_WEBHOOK_URL`、`CONSOLE_BASE_URL`；未配置则通知模块为 no-op。

### Secret 名称清单

| 名称 | 用于 | 位置 |
| --- | --- | --- |
| `FEISHU_VERIFICATION_TOKEN` | 事件 header.token 校验 | Edge Function |
| `FEISHU_ENCRYPT_KEY`（可选） | 验签与解密；设置后拒绝明文请求 | Edge Function |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 换取 tenant_access_token，回执与卡片 | Edge Function + worker |
| `WECOM_BOT_TOKEN` / `WECOM_ENCODING_AES_KEY` | 回调验签与加解密 | Edge Function |
| `WECOM_NOTIFY_WEBHOOK_URL` | 群机器人推送待审通知（含 key，视为 Secret） | worker |
| `CONSOLE_BASE_URL` | 回执与卡片中的控制台链接（默认 https://story.susense.cn） | 二者 |

限制：当前一套 Secret 对应一个飞书应用 / 一个企微机器人（部署级），按组织区分的是路径中的 `connection_id`。多个机器人需要把密钥按连接存储，尚未实现。

## worker 集成（待集成，未改 `runner.ts`）

在 `workers/agent/runner.ts` 的 `processNextJob` 中、`log.info("job finished", …)` 之后加一行：

```ts
await notifyJobNeedsHuman({ rpc: (fn, args) => backend.rpc(fn, args), log: (e, f) => log.warn(e, f) }, { id: job.id, status: outcome.status })
```

并 `import { notifyJobNeedsHuman } from "./notify/im-notify"`。`backend` 需要暴露一个调用 service_role RPC 的 `rpc(fn, args)`（返回 `{data, error}`）；若 `AgentQueueBackend` 尚无此方法，包装底层 supabase client 的 `.rpc` 即可。函数永不抛错，只对 `pending_review` / `blocked_needs_human` 且来自 IM 连接的任务发送。

## 控制台指引组件挂载

`<ImChannelGuide />`（`src/components/intake/im-channel-guide.tsx`）可直接放在 `integrations-page.tsx` 的一个 Tab/分区中；它不依赖数据、只展示步骤、Webhook 模板和 Secret 名称。

## 验证状态

| 项 | 状态 |
| --- | --- |
| 飞书加密（AES-256-CBC，key=SHA256(EncryptKey)，IV=前16字节）与签名公式 `sha256(timestamp+nonce+key+body)`、头名 | 已对照官方文档 |
| 企微智能机器人回调字段（msgid/chatid/chattype/from.userid/text/mixed）、receiveid 为空、加密回复信封、stream 被动回复 | 已对照官方文档 |
| 企微 `msg_signature = sha1(sort(token,timestamp,nonce,encrypt))`、AES key 派生与明文布局 | 通用企微回调方案，本次**未**逐页对照 |
| 飞书 url_verification、事件 v2 信封、post 富文本结构、card.action.trigger 应答、发送/回复/tenant_access_token 接口、卡片 JSON 1.0 | 按公开结构实现，**未对照官方文档**（页面为前端渲染，抓取不到） |
| 企微群机器人 markdown 推送格式 | 凭记忆，**未对照官方文档** |
| 时间戳 5 分钟重放窗口 | 本项目自定策略（官方未规定） |
| Edge Function 能否打包 `../../../adapters/im/*.ts`（函数目录外的相对导入）及 `node:crypto` | **未验证**（本机无 Deno / supabase CLI）；若部署工具不支持，可把 `adapters/im` 复制进函数目录或改用 import map |
| 真实飞书 / 企微联调、手机端、卡片在客户端的渲染 | **未做**（不调用真实 API） |

自动化测试：`adapters/im/im-adapters.test.ts`（协议与路由、通知）、`src/test/db/im-channels-db.test.ts`（PGlite：重复 message_id 只收录一次、撤销/过期/错配连接被拒、auto_draft 产生 job、通知目标解析、RLS）。

## 未做

- **IM 内一键批准**：批准必须是真实登录的后台成员（`decide_approval_request` 由数据库强制）。需先做「IM 用户 ↔ 后台账号」身份绑定（绑定流程、解绑、版本绑定的一次性令牌），本阶段不做；卡片只跳转到控制台。
- `补充到 #任务号 / 改一下 #任务号`（只回复提示）、图片/文件/语音附件收录。
- 历史卡片失效（改稿后旧卡片）：因卡片无批准动作，目前不适用；做 IM 批准时必须绑定 `document_id + revision + channel_id`。
- 每连接独立的机器人密钥存储、连通性自检按钮、卡片内「退回并写入 Decision Memory」。
