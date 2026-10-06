# Dot 手机云端收录：任务与验收记录

更新：2026-10-06（Asia/Shanghai）。结论：**手机端尚未连通，不能宣布可成功验收。**

## 已确认范围

手机发给 Dot → Dot 自己的云端 → HTTPS 收录 API → 候选选题及真实回执。Mac 关机仍可用；不使用插件。秘密不得放进聊天，不复制本机凭证，不生成稿件、不审核、不发布。

## 已完成

| 项目 | 状态与证据 |
| --- | --- |
| 原收录 API | intake-gateway 已部署；受限令牌、事务入库、防重、回执已实现。 |
| 网站 HTTPS | 用户已配置，此前正常 TLS 检查通过，无需再次配置证书。 |
| 前端部署 | 用户已上传上一版 dist；该版包含后来被否决的插件授权页。 |
| 原 API 实测 | 历史选题 11、12 来自 Mac 脚本，不能算 Dot 云端成功。 |
| 插件卸载 | plugin_asdk_app_6ac5142ed27c819180978be6b9e62a5b 返回 uninstalled。 |
| 插件代码清理 | 专用授权页、路由、前端服务、MCP 函数源码、专用测试、配置及插件安装文档已移除。 |
| 插件云端下线 | CLI 已返回 Deleted Edge Function，目标 intake-mcp；保留 intake-gateway。 |

已执行的 `20261006141445_intake_remote_oauth.sql` 保留为数据库历史；其 RLS 保护的内部表/RPC 暂留，云端函数入口已删除，不作为当前方案。未删除原选题或原收录凭证。

## 待办（按顺序）

| 任务 | 现状 / 负责人 / 验收标准 |
| --- | --- |
| D1 Dot 云端执行与 HTTPS 探测 | Dot 有 exec_command；上次 exec-server transport disconnected / recovery timed out，请求未发出。由 Dot 主线程恢复后做无凭证 HTTPS 探测，记录 HTTP 状态；本机不能替代。 |
| D2 云端安全授权 | 凭证安全交付、保管和撤销机制尚未建立。由 Dot 主线程核实实际支持能力后实施；不再先造另一条路线，禁止无鉴权公开写入。 |
| D3 首次收录与防重 | 尚无 Dot 云端回执。D1、D2 完成后，同一 external_id 和相同正文提交两次，返回相同 receipt_id、selection_id，第二次 duplicate=true。 |
| D4 手机离线验收 | 用户关掉 Mac，用手机向 Dot 发送新内容，获得真实回执及选题链接，网页刷新后仍存在。尚未完成。 |
| D5 发布清理后的前端 | 本地构建完成后，用户上传新 dist 到 Nginx。此操作只移除旧插件页面，不能解决 D1、D2，不能据此承诺手机可用。 |

## 原 API 契约

POST `https://ryhdcdljryllgkekfjan.supabase.co/functions/v1/intake-gateway`，JSON；`Authorization: Bearer <受限收录令牌>`。

必填 version=1、intent=capture、external_id、text；可选 title、url、angle。成功返回 receipt_id、signal_id、selection_id、duplicate、status=captured、topic_path。用 `https://story.susense.cn` 拼接 topic_path。

同一连接、相同 ID 与正文重试返回原回执；同 ID 不同正文返回 409。失败时保留 ID，不能换 ID 掩盖不确定结果。

历史失败消息：external_id `dot:302ec8ce-f028-4379-b8c0-359cbab92049`；文件 `/tmp/spark-intake-5zbz7deq/message.json`；fetch failed，无有效回执。仅保留历史，不代表该文件仍存在或应从 Mac 再次提交。

## 证据与维护

依据当前对话、Dot 主线程 `01a0f4ff-c813-7512-9fc5-dd301dd36012` 实际工具记录、项目文档、插件卸载和云端函数删除回执。个人上下文服务此次不可用，已直接读取主线程核对。

后续任务先读本文件；每次推进更新状态、证据与下一步。没有真实云端回执不能勾选 D3、D4；网页部署、Mac 成功和请求发出均不算完成。

## 本次清理验证

- typecheck、lint、27 项单元测试、build 通过；构建主包仍有 >500 KB 提示。
- 云端只读核验：已撤回的 intake-mcp/status 返回 404；原 intake-gateway 的 GET 返回 405（该接口要求 POST）。未发送新收录消息。这是开发环境检查，不替代 Dot 云端验收。
- 新前端产物：sense-console/dist/，主入口 assets/index-DqFLceil.js。需由用户上传替换线上旧版本。
- 现有 HTTP/HTTPS 凭证浏览器回归测试 2 项通过；不包含真实 Dot 授权或云端收录。
