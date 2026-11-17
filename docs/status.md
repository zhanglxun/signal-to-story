# 实现状态与本地验证

> 2026-11-17 · 基线是 `codex/0.3` 的代码（即 V2 的 P1～P7），已按 R1 重排目录（功能与数据库未变）。替代旧的 V2 实施总计划、验收清单和 README 中的状态段落。

## 1. 总体状态

V2 的 P1～P7 都已**写完代码并在本地验证通过，但没有部署到线上**。验证只在进程内 Postgres（PGlite）和假客户端上做过；真实 Supabase、真实 IM、真实视频引擎、真实浏览器点测都还没有做。

线上（story.susense.cn）只有 V1：信源分类、待处理信息、选题、内容项目与稿件、审核、人工发布与复盘，以及 `intake-gateway` 收录网关。2026-11-15 之后的 migration、知识库种子都没有应用到线上。

| 能力 | 代码 | 线上 |
| --- | --- | --- |
| 云端稿件、版本、审核、人工发布与复盘 | 有 | 有 |
| 外部收录网关 `intake-gateway` | 有 | 有 |
| Agent 任务队列与 worker（生成↔评估 ≤3 轮） | 有 | 无 |
| 决定记忆、知识库（信任分级） | 有 | 无 |
| 数据库 Mandate 门禁 | 有 | 无 |
| Web 速记与「采集 → 出稿待审」 | 有 | 无 |
| 飞书 / 企微收录与待审通知 | 有，未联调 | 无 |
| 视频工坊与 Python 视频 worker | 有，引擎只跑过 dry-run | 无 |
| 发布到读者站（请求 → 批准 → 发布） | 有 | 无 |
| 读者站 sense-site | 有，演示模式可用 | 无 |
| Chat | 只有 Vite 开发期转接，生产不可用 | 无 |

## 2. 本地验证命令

不需要后端，也不产生费用（全部使用假模型）：

```bash
# 仓库根目录：运行时一侧（workers、PGlite 全量迁移 + RLS 测试）
npm install
npm run typecheck && npm run lint && npm test
npm run test:video-worker
npm run demo:harness   # 出稿循环：先失败后通过 / 三轮不过转人工
npm run demo:capture   # 一条链接 → 两份待审提案
npm run demo:video     # 大纲 → 分镜 → 批准 → 占位成片

# Web
npm --prefix sense-console run typecheck && npm --prefix sense-console run lint
npm --prefix sense-console run test && npm --prefix sense-console run build
npm --prefix sense-site run dev:demo          # 读者站演示数据
```

2026-11-17 R1 后的结果：根目录 140 条、sense-console 152 条、sense-site 47 条、Python 18 条全部通过；三个 demo 均 PASS。

## 3. 已知断层

**没有做**

- 组织级模型密钥配置（BYOK）；worker 读自己的环境变量。
- 受限的 worker 凭证；worker 使用 `service_role`，放在个人电脑上有风险（0.5 规划用 `runner_nodes` 替代）。
- IM 内批准（首版不做，审批只在控制台进行）。
- 视频：关键帧自动生成、云端 TTS、多轨时间线、拖拽排序。
- CLI 工作区物化与会话续接（0.5 规划为 `agent_session` 模式）。

**没有验证**

- 真实 Supabase 下的 Data API、Storage 签名链接、Auth。
- Edge Function 的入队模式；`im-webhook` 的 Deno 打包和部署。
- 飞书 / 企微的部分协议字段（见 [intake.md](modules/intake.md)）。
- Codex CLI 从未真实调用过；pi / opencode / agy 的参数未核实，worker 会拒绝使用它们。
- 真实 TTS、视频模型、全分辨率合成和计费。
- 控制台页面从未在真实浏览器里逐页点测。
- Dot（手机端）通过收录网关接入从未验收。

## 4. 上线前的部署顺序（需要人批准后执行）

1. 先在隔离库演练，再按文件名顺序把 migration 应用到线上（在仓库根目录 `supabase db push`），不手工建表。注意新增的私有存储桶和存储策略。
2. 执行知识库种子 `supabase/seeds/knowledge_base.sql`。
3. 部署 Edge Functions；`intake-gateway` 和 `im-webhook` 使用 `--no-verify-jwt`（由函数自己校验令牌或平台签名）。
4. 按各 worker 的 `.env.example` 配置环境变量后启动 worker（`docker-compose.yml` 或根目录 `npm run worker:agent`）。
5. 分别构建并部署两个前端。
