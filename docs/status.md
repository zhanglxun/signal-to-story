# 实现状态与本地验证

> 2026-11-25 · `main`（0.5.0 已合并，`f80cb51` 起）。DB0～DB5、DB3b、R0～R3 已完成；线上库已执行至第 6 批 `20261127100000`；0.5 控制台已部署到 `story.susense.cn`；读者站暂不上线（用户决定）。下一轮迭代见 [tasks/iteration-1.md](tasks/iteration-1.md)。

## 1. 总体状态

- **线上数据库**：按分批发布机制（DB-D14，见 [database.md](database.md) 第 8.1 节与 [supabase/release/README.md](../supabase/release/README.md)）执行完第 1～6 批。第 5 批（DB3 / DB4 / DB5 / V1 退役）于 2026-11-24 核对 9 项通过；第 6 批（DB3b）于 2026-11-25 执行并核对。public schema 为 21 张表、0 个视图，`node_*` RPC 15 个。库内快照未建立。
- **线上控制台（story.susense.cn）**：2026-11-25 部署 0.5 构建。用户的完整人工验收待做。
- **执行节点**：本机节点 `jarvis-mac` 在线，开启 HTTP 入口（`127.0.0.1:8787`）与 `qwen3.8-flash` 运行时；手动在终端启动，尚无启停命令（下一轮迭代）。没有公网节点。
- **验证覆盖**：离线自动化（PGlite 迁移与 RLS、假模型 Agent 循环、假驱动 HTTP 入口、jsdom 前端单测、Python 视频 dry-run、假 Supabase + 假节点的 Chat Playwright）全部通过；线上已真实跑通出稿一次（2026-11-23）与 Chat 两轮（2026-11-25）。

| 能力 | 代码 | 线上 |
| --- | --- | --- |
| 稿件、审核、发布（`content_documents.published_*`，读者站 + 外部链接回填） | 已有（DB4） | 库已上线；发布到读者站待读者站上线 |
| 外部收录网关 `intake-gateway` | 已切换至 `intake_events` | 需确认 Edge Function 已同步至最新版 |
| 收件箱 `intake_events` 与事项 `work_items` | 已有 | 控制台已部署，待人工验收 |
| Agent 任务队列（`agent_jobs`、`lease_epoch`、卡片同步、`notified_at`） | 已有 | 已上线 |
| AI 直接写草稿（`write_document_draft` + `base_revision` 防覆盖） | 已有（DB2c-3） | 2026-11-23 真实出稿一次通过 |
| 执行节点 `runner_nodes` + 15 个 `node_*` RPC + 能力目录 | 已有（DB2c-2、DB3b） | 已上线，本机节点在线并上报目录 |
| 数据库 Mandate 门禁与 Agent 提问 | 已有 | 已上线，待真环境联调 |
| Web 速记与「采集 → 出稿待审」 | 已有 | 控制台已部署，待人工验收 |
| 飞书 / 企微收录与待审通知 | 已有（`supabase/functions/_shared/im`） | 未部署 `im-webhook`、未真机联调 |
| 视频工坊与 Python 视频 worker | 已有（DB5；引擎仅跑 dry-run） | 库已上线；未真环境联调；视频 worker 仍用 `service_role` |
| 读者站 `sense-site` | 已改读 `content_documents.published_*` | 暂不上线 |
| 知识库 | 读仓库 `knowledge-base/` 文件 | — |
| Chat（[modules/chat.md](modules/chat.md)） | 全部实现：DB3b、Pi / ACP 驱动、HTTP/SSE 入口、`chat-turn` 处理器、新 Chat 界面、配置页读节点目录 | 本机节点 + Chrome 已跑通（第 6.4 节）；公网节点、手机端、ACP 真机未验证 |

## 2. 本地验证命令

不需要后端，也不产生费用（全部使用 PGlite 与假模型）：

```bash
# 仓库根目录：运行时一侧（workers、PGlite 全量迁移 + RLS + 发布脚本演练）
npm install
npm run typecheck && npm run lint && npm test
npm run test:video-worker
npm run demo:harness   # 出稿循环：先失败后通过（直接写 v2）/ 三轮不过转人工
npm run demo:capture   # 一条链接 → 直接写出两份 v2 草稿
npm run demo:video     # 大纲 → 分镜 → 批准 → 占位成片

# Web（控制台与读者站）
npm --prefix sense-console run typecheck && npm --prefix sense-console run lint
npm --prefix sense-console run test && npm --prefix sense-console run build
(cd sense-console && npx playwright test -c e2e/chat.playwright.config.ts)   # Chat：假 Supabase + 假节点
npm --prefix sense-console run test:e2e -- e2e/console.spec.ts e2e/intake-http.spec.ts
npm --prefix sense-site run typecheck && npm --prefix sense-site run lint
npm --prefix sense-site run test && npm --prefix sense-site run build
npm --prefix sense-site run dev:demo          # 读者站演示数据
```

2026-11-25 实测（全部通过）：根目录 vitest **37 个文件 / 349 条**，Python 视频 worker **19 条**；`sense-console` vitest **36 个文件 / 210 条**与 Chat Playwright；`sense-site` vitest **5 个文件 / 29 条**；各项目 typecheck / lint / build 通过。

## 3. 已知断层

**没有做**

- **R4**：前端按域重组与看板、mock 页（角色、场景、画布、脚本、仪表盘）标为演示或下线。
- 部署与启停命令（下一轮迭代第一项）；公网节点（隧道或云端容器）。
- `workers/video` 切换节点令牌（当前仍用 `service_role`）。
- 出稿用的 `LlmClient` 仍是手写 `cloud-llm.ts`，未切到 `pi-ai`。
- 按用户 / 组织的日累计模型预算；`node_whoami` RPC（去掉 `SENSE_NODE_ID` 手填）。
- 组织级模型密钥配置（BYOK）、IM 内批准、视频关键帧自动生成 / 云端 TTS / 多轨时间线。

**没有验证**

- 控制台逐页人工验收（含 README 第 5 批「执行后验收」5 项）。
- Chat：公网 HTTPS 节点、手机 `/h5/chat`、Safari、停止 / 重新生成 / 工具 / 权限确认在真实模型上的表现、DeepSeek 等其他厂商、ACP 真机（本机有 `opencode`，无 `codex-acp`）。
- 真实 Supabase 下的 Storage 签名链接与云端账号 Playwright E2E（`content-workflow.spec.ts`、`intake-gateway.spec.ts`）。
- Edge Function 打包与部署（尤其是 `im-webhook` 的 Deno 打包）；飞书 / 企微的部分协议字段（见 [intake.md](modules/intake.md)）。
- 真实 TTS、视频模型、全分辨率合成和计费。
- Dot（手机端）通过收录网关接入。

## 4. 发布与上线

1. **数据库**：每批由 `npx tsx testing/db/release.ts` 从迁移文件生成单事务 SQL，在模拟线上状态的 PGlite 上演练通过后，按 [supabase/release/README.md](../supabase/release/README.md) 预检 → 执行 → 核对。不直接执行未对账的 `supabase db push`。第 1～6 批已全部执行。
2. **控制台 / 读者站**：`npm --prefix <项目> ci && npm --prefix <项目> run build`，替换线上静态文件；自检在服务器上 grep 主 JS（部署机本地 https 校验曾因证书链失败，不能据此回滚）。读者站构建时 `VITE_SITE_DEMO` 必须为空。
3. **执行节点**：`set -a && source workers/agent/.env.local && set +a && npm run worker:agent`；HTTP 入口、运行时目录与 ACP 的变量见 `workers/agent/README.md`。下一轮迭代收敛为启停命令。
4. **Edge Functions**：按需部署（`intake-gateway`、`im-webhook`、`content-draft`；webhook 类使用 `--no-verify-jwt`）。
