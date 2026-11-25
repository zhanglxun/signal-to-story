# 实现状态与本地验证

> 2026-11-26 · 分支 `0.5.0`（DB0～DB5、退役迁移与 R0～R1 已完成；线上库已执行至第 4 批 `20261125100000`；最终批次 `0.5.0-step5.sql` 已于 2026-11-24 在线上执行，核对 9 项全部通过；**0.5 控制台与读者站尚未部署**）。

## 1. 总体状态

- **线上数据库**：已按分批发布机制（DB-D14，见 [database.md](database.md) 第 8.1 节与 [supabase/release/README.md](../supabase/release/README.md)）推送至第 4 批 `20261125100000_ai_direct_draft`（2026-11-23 核对通过）。剩余全部数据库工作（DB4 发布列、DB5 视频精简、DB3 Chat 表、V1 退役）合并为**最终批次** `0.5.0-step5.sql`（DB-D17），代码已改完、PGlite 演练通过，待 Codex 执行；执行后 public schema 为 21 张表、0 个视图。
- **线上控制台（story.susense.cn）**：仍部署着 V1。**最终批次删除 V1 旧表后 V1 控制台会失效**，需紧接着部署 0.5 控制台与读者站。
- **验证覆盖**：离线自动化验证（PGlite 迁移与 RLS、假模型 Agent 循环、jsdom 前端单测、Python 视频 dry-run、无凭证本地 Playwright E2E）已于 2026-11-22 全部通过；第 4 批上线后已真实跑通一次出稿（节点认领 → 直接写 v2 → 审核通过 → 任务完成）；真实 IM 联调、真实视频计费渲染、云端账号浏览器 E2E 待最终批次上线后验收。

| 能力 | 代码 | 线上库 | 线上控制台 / 真实联调 |
| --- | --- | --- | --- |
| 稿件、审核、发布（`content_documents.published_*`，读者站 + 外部链接回填） | 已有（DB4） | 待最终批次 | 外部发布三表、版本快照表退役；审核历史进 `audit_events` |
| 外部收录网关 `intake-gateway` | 已切换至 `intake_events` | 第 1 批已就位 | 需确认 Edge Function 已同步至最新版 |
| 收件箱 `intake_events` 与事项 `work_items`（含筛选、分页、弹窗表单与 V1 回填） | 已有（含 `cebd1d7` 增强） | 第 1 批已上 | 本地 0.5 控制台可用；未上线 |
| Agent 任务队列 MVP（21 列 `agent_jobs`、`lease_epoch`、卡片同步、`notified_at`） | 已有 | 第 2 批已上 | 本地 0.5 控制台直连 `enqueue_agent_job` RPC 入队；待真实节点联调 |
| AI 直接写草稿（`write_document_draft` + `base_revision` 防覆盖、审核自动完成任务、退役 `content_ai_proposals`） | 已有（DB2c-3） | 第 4 批已上 | 2026-11-23 真实出稿一次通过 |
| 执行节点身份 `runner_nodes` + 12 个 `node_*` RPC（agent worker 脱离 `service_role`） | 已有 | 第 3 批已上 | 最终批次后仍为 12 个：去掉分镜提案与分镜知识两个，新增 `node_write_video_draft`、`node_append_chat_message` |
| 数据库 Mandate 门禁与 Agent 提问 | 已有 | 第 1 批已上 | 待真环境联调 |
| Web 速记与「采集 → 出稿待审」 | 已有 | 第 1 批已上 | 本地 0.5 控制台可用；未上线 |
| 飞书 / 企微收录与待审通知 | 已有（共享至 `supabase/functions/_shared/im`） | 第 2 批已支持 `notified_at` | 未部署 `im-webhook`、未真机联调 |
| 视频工坊与 Python 视频 worker | 已有（DB5：AI 直接写草稿分镜、无成本账本；引擎仅跑 dry-run） | 待最终批次 | 未真环境联调；视频 worker 仍用 `service_role`，切换节点令牌留待后续 |
| 读者站 `sense-site` | 已改读 `content_documents.published_*`（anon 列授权）；专题 / 资源 / 读者账号 / 收藏下线 | 待最终批次 | 最终批次后部署 |
| 知识库 | 读仓库 `knowledge-base/` 文件（worker 直接读，控制台只读展示）；决定记忆下线 | 两表待最终批次删除 | — |
| Chat | 表与 RPC 已有（DB3）；DB3b 代码完成（step6 待上线）；worker HTTP/SSE 入口与 `chat-turn` 处理器已实现（只用假驱动验证）；`PiCloudDriver`、ACP 驱动已实现（均未用真实 Key / 真实 CLI 验证）；模型页 / CLI 页改为只读展示节点上报的能力目录（不再写 `.env.local`）；新 Chat 界面第一波已合并（`sense-console/src/modules/chat`，临时路由 `/chat-next`，`VITE_CHAT_TRANSPORT=mock` 下可完整演示）；回合内核与 HTTP/SSE 入口在 `feat/r3-core` 开发中 | 待最终批次 | 生产不可用：真实传输要等 DB3b 与 HTTP 入口；旧 `/chat` 仍在用 |

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
npm --prefix sense-console run test:e2e -- e2e/console.spec.ts e2e/intake-http.spec.ts
npm --prefix sense-site run typecheck && npm --prefix sense-site run lint
npm --prefix sense-site run test && npm --prefix sense-site run build
npm --prefix sense-site run dev:demo          # 读者站演示数据
```

2026-11-26 最终批次实测结果（全部通过）：

- 根目录 runtime：`typecheck` / `lint` 通过；`vitest` **27 个测试文件 / 193 条用例**全部通过（含 `publish-document-db.test.ts` 与 `release-step5.test.ts`）；`test:video-worker` **19 条 Python 用例**全部通过。
- `sense-console`：`typecheck` / `lint` / `build` 通过；`vitest` **28 个测试文件 / 177 条用例**全部通过。
- `sense-site`：`typecheck` / `lint` / `build` 通过；`vitest` **5 个测试文件 / 29 条用例**全部通过（含真实迁移上的 anon 权限测试）。

## 3. 已知断层

**没有做**

- ~~**R2**~~：已完成（2026-11-24）。`sense-console/src/harness` 迁入 `workers/agent/loop`，worker 不再引用控制台；旧 Chat 页去掉浏览器内循环；ESLint 边界规则在根目录与控制台两侧生效。
- **R3**：统一 Agent 循环、`chat-turn` handler、HTTP/SSE 入口（表与 RPC 已由 DB3 建好）、删除 Vite 开发期 `spawn`。
- **R4**：前端按域重组与看板、mock 页标为演示或下线。
- `workers/video` 切换节点令牌（当前仍用 `service_role`）。
- 组织级模型密钥配置（BYOK；当前 worker 读环境变量）、IM 内批准、视频关键帧自动生成 / 云端 TTS / 多轨时间线。

**没有验证**

- 最终批次（`0.5.0-step5.sql`）推送线上后：0.5 控制台与读者站部署、发布到读者站全链路、视频分镜草稿直写。
- 真实 Supabase 下的 Data API、Storage 签名链接与完整 Auth / 云端账号 Playwright E2E（`content-workflow.spec.ts`、`intake-gateway.spec.ts`）。
- Edge Function 打包与部署（尤其是 `im-webhook` 的 Deno 打包）；飞书 / 企微的部分协议字段（见 [intake.md](modules/intake.md)）。
- Codex CLI（`codex exec`）从未真实调用过；pi / opencode / agy 的参数未核实，worker 会拒绝使用它们。
- 真实 TTS、视频模型、全分辨率合成和计费。
- 控制台页面从未在真实浏览器里逐页全量点测。
- Dot（手机端）通过收录网关接入从未验收。

## 4. 发布与上线顺序

线上数据库已采用 DB-D14 分批单事务发布流程（不再直接执行未对账的 `supabase db push`）：

1. 每批先由 `npx tsx testing/db/release.ts` 从迁移文件生成单事务 SQL，并在模拟线上状态的 PGlite 上通过 `release*.test.ts` 演练；详见 [database.md](database.md) 第 8 / 8.1 节与 [supabase/release/README.md](../supabase/release/README.md)。
2. **当前待办**：由 Codex 按手册执行 `supabase/release/0.5.0-step4.sql`；用户在本地控制台「系统配置 → 本地 CLI 接入 → 执行节点」创建节点并保存只显示一次的令牌，使用 `SUPABASE_PUBLISHABLE_KEY` + `SENSE_NODE_TOKEN` 启动 `npm run worker:agent` 跑通完整出稿与审核闭环后再轮换旧的 secret key。
3. Edge Functions 随对应批次按需部署（如 `intake-gateway`、`im-webhook`、`content-draft`；webhook 类函数使用 `--no-verify-jwt`）。
4. 完成 DB4 与 R4 后，构建并部署新版 `sense-console` 与 `sense-site`。
