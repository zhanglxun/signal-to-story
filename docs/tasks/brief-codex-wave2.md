# 任务简报 · Codex · 一次性收尾：部署补齐 → DB3b → ACP 驱动 → 配置页改读节点目录

> 2026-11-24 · 分工与规则见 [parallel-plan.md](parallel-plan.md)。合并、验收由 Claude 负责。

## 0. 背景（Claude 2026-11-24 的只读核对）

- 线上数据库 step5 **已完成且核对全部通过**：`20261126100300`、21 张表 / 0 视图、旧表全删、`node_*` = 12、`work_item_id` 必填、审核 21 / 信号 34 已迁入、`anon` 只读发布列、Chat 表已建。
- **库内快照不存在**（`backup_v050_step5` 没有建出来）。
- **线上控制台 `story.susense.cn` 仍是 V1**（`Last-Modified` 为 2026-10-08，主包没有 `/work-items`，仍引用已删除的 `content_projects`）：**前端没有部署，线上控制台当前不可用**。
- agent 节点 `jarvis-mac` 在线，代码版本未知；视频 worker 位置与版本未知。

## 启动提示词（用户整段发给 Codex）

```text
你在 signal-to-story 仓库的 worktree ../sts-db 中工作。先执行 git switch feat/db3b && git merge --ff-only 0.5.0
（0.5.0 已合并 R2、R3 回合内核和 Chat UI，并含本简报）。然后完整阅读 docs/tasks/brief-codex-wave2.md，按阶段 A → B → C → D 连续执行，
中途不等用户确认；只有简报写明的「停止条件」才停下汇报。每个阶段结束都跑该阶段列出的门禁，全部通过才进入下一阶段。

通用规则：不 push、不 merge 到 0.5.0、不改 supabase/release/0.5.0-step1～5.sql；不在任何输出、日志、提交、文档里写密钥、
连接串、项目 ID、节点令牌或个人路径；DATABASE_URL 只用于 psql，不打印。只改简报为该阶段列出的目录。
最后按 docs/tasks/parallel-plan.md 第 5 节格式输出一份交付报告，按阶段 A/B/C/D 分节。
```

## 阶段 A：补齐 step5 的部署（线上操作，最先做）

1. **回答三个事实问题**（写进报告）：
   - step5 时 CLI 备份最终有没有做成？做成了就给出文件大小（不贴内容、不给路径）；库内快照为什么没建出来。
   - agent worker 现在由哪个目录、哪个提交启动（`git -C <目录> log -1 --format=%h` 的短 hash 即可，不写路径）。
   - 视频 worker 运行在哪里（本机进程 / 容器 / 未运行）、用哪个提交或镜像构建。
2. **部署控制台**：从 `0.5.0` 当前提交构建 `sense-console`（`npm --prefix sense-console ci && npm --prefix sense-console run build`），按现有方式替换 `story.susense.cn`。
   - 自检：`curl -s https://story.susense.cn/` 取主 JS，确认其中能找到 `/work-items` 与 `/h5/chat`、找不到 `content_projects`；响应头 `Last-Modified` 为今天。
3. **部署读者站**：从同一提交构建 `sense-site`（`VITE_SITE_DEMO` 必须为空，变量见 `supabase/release/README.md` 第 5 批第 6 步），按现有方式替换线上读者站。报告里写明读者站的**线上域名**与自检结果（首页 200、无演示数据）。
4. **重启 worker**：agent worker 用 `0.5.0` 当前提交重启（`npm run worker:agent`）；视频 worker 若在运行，用同一提交重建后重启。重启后用只读 SQL 确认 `runner_nodes.last_seen_at` 在 2 分钟内。
5. **停止条件**：构建失败；部署后自检不通过（立即回滚到部署前的产物，并汇报）。

## 阶段 B：DB3b（只在仓库与 PGlite，不上线）

按 [brief-codex.md](brief-codex.md) 的「任务 B」与 [db3b-chat-runtime-catalog.md](db3b-chat-runtime-catalog.md) 全部需求（0～6，含需求 6 Realtime 发布）完成，并生成 `0.5.0-step6.sql`。**不执行 step6**。

- 目录：`supabase/migrations/`、`supabase/tests/db/`、`supabase/release/`、`testing/db/`。
- 门禁：`npm run typecheck && npm run lint && npm test`；`npx tsx testing/db/release.ts && git diff --exit-code supabase/release/0.5.0-step{1,2,3,4,5}.sql`。
- 在 `feat/db3b` 上提交，提交后**另开分支** `feat/codex-wave2`（从 `feat/db3b` 切出）做阶段 C、D。

## 阶段 C：`AcpSessionDriver`（R3.4）

- **约定以已合并的 `workers/agent/loop/chat/driver.ts` 为准**（规则 1～6：每次 `session/prompt` 前调一次 `beforeModelCall`；有用量才发 `usage`；`requestPermission` 只用于 CLI 自己的敏感动作；续接会话时发送 `turn`（文本 + 引用）而不是 `messages`；`exec_session` 带 `node_id`）。不要改 `loop/` 下任何文件；需要接口变化时写进报告。
- 新文件：`workers/agent/drivers/acp-driver.ts`、`workers/agent/drivers/acp-registry.ts`（按 `sessionId` 管理子进程：每会话最多一个、空闲 10 分钟关闭、节点最多 3 个并发、进程退出时全部清理）及其测试。
- 根目录 `package.json` 加 `@agentclientprotocol/sdk`（精确版本，发布满两周）；lockfile 冲突一律重新 `npm install` 生成。
- 安全约束按 [../ACP-info.md](../ACP-info.md) 第 7 节：`CLI_ENV_ALLOWLIST`；每会话独立临时 `cwd`；`initialize` 不声明宿主 `fs` / `terminal` 能力；启动适配器时选 CLI 自身最严格的沙箱 / 审批档位；`cwd` 外读取与一切写入 / 命令 / 联网都走 `requestPermission`；不展示「总是允许」。
- 测试：用一个**仓库内的假 ACP Agent 脚本**（stdio JSON-RPC，可放 `workers/agent/drivers/testing/`）覆盖：`session/new`、`session/load` 续接、`agent_message_chunk` / `agent_thought_chunk` / `plan` / `tool_call(_update)` 映射为 `ChatStreamEvent`、`request_permission` 允许 / 拒绝 / 超时、`session/cancel`、子进程崩溃、并发上限；并用 `runChatTurn` + 假端口跑一轮端到端。
- **本机真机验证**：先 `opencode`，再 `codex-acp`。只记录版本号、启动参数是否有效与 5 项结果（流式正文、思考、计划、工具 / 权限、取消）；本机未安装就如实写「未验证」，不猜参数。
- 门禁：根目录 `typecheck / lint / test`。

## 阶段 D：配置页改读节点目录（R3.5 前半）

- `sense-console/src/pages/models-integration-page.tsx` 与 `cli-agents-page.tsx`：改为读取在线 `runner_nodes`（`last_seen_at` 2 分钟内、未吊销）的 `capabilities.runtimes`，按节点分组展示；**不再写 `sense-console/.env.local`**，改为显示「在 worker 所在机器配置环境变量 / 启动节点」的指引。`capabilities` 还没有节点上报时显示空态（上报代码由 Claude 的 R3-A 提供）。
- 删除这两个页面对 `/__sense_bridge/env` 的调用；`sense-console/dev/local-bridge-plugin.ts` 中**只删** `/__sense_bridge/env` 路由。`/__sense_bridge/chat` **暂不删**：旧 `/chat` 页在本地开发时还依赖它，等新 Chat 切换路由（Gemini 第二波 B）后再删。
- 目录：上述两个页面、相关 service、`dev/local-bridge-plugin.ts`、对应测试。不碰 `src/modules/chat/**`。
- 门禁：`npm --prefix sense-console run typecheck && … lint && … test && … build`。

## 不做

- 不执行 step6、不改 HTTP 入口 / `PiCloudDriver` / `handlers/chat-turn` / `runtime-registry`（Claude 在做）。
- 不删除旧 Chat 页、不切换 `/chat` 路由。
