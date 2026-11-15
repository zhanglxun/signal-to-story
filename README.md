# 星火工厂 · Signal to Story

星火工厂（Signal to Story）是一个面向个人与小团队内容生产、AI 协作的 **Content Ops 控制系统**。

它把信息源、线索、选题、内容项目、任务、故事、脚本、分镜、人物、场景、媒体资产、发布记录和复盘数据组织成一个可查询、可审核、可追踪的生产系统。

产品中文名统一为 **星火工厂**，英文名为 **Signal to Story**；中英文组合展示名为 **星火工厂 · Signal to Story**。Web 工程目录名保留为 `sense-console`，读者内容站工程目录名为 `sense-site`，企业及版权标识暂用 `susesne.cn`。

## 核心定位

> 星火工厂控制台（Signal to Story Console）是内容生产系统的控制面和资产关系可视化中心；Supabase 管理身份、运行状态、任务队列、决定记忆、知识库与审计；独立后台 Worker（Agent / Video）负责异步自循环与媒体渲染；原始媒体物料保存在独立对象存储中。

| 组成 | 主要职责 |
| --- | --- |
| `sense-console` | 驾驶舱、内容与任务可视化、指令下达、审核和资产关系查询 |
| `sense-site` | 独立读者内容站，只读经人工批准并显式发布的快照（P7 建设） |
| Supabase | Auth、Postgres、Data API、任务表队列 `agent_jobs`、Mandate 门禁、审计及 Edge Functions |
| Sense Agent Harness | 指令数据隔离、生成↔评估自循环（≤3 轮）、决定记忆回灌与双模驱动（Cloud API + CLI） |
| Worker（`workers/`） | Node Agent Worker（`workers/agent/`，P1.5）与 Python Video Worker（`workers/video/`，P5） |
| 对象存储 | 图片、音频、视频、字幕和其他原始二进制物料（OSS / R2 / S3 / Supabase Storage） |
| 内建知识库与 Markdown | 仓库 `knowledge-base/` 为默认种子，运行时权威是 Postgres，支持标准 `.md` 显式导入导出 |

## 核心原则

1. Console 管控制与展示，不承担长时间任务。
2. Supabase Postgres 管状态、队列和关系，不存放大型二进制文件。
3. 对象存储管原始物料，数据库保存可审计的元数据和关系。
4. 前端可通过 Supabase SDK 完成受 RLS 保护的普通 CRUD，不建设传统后台 API。
5. 服务端 Secret、Webhook、强校验和受控网关使用 Edge Functions 或可信执行环境。
6. Agent 提交 Proposal/Draft，人类保留批准、发布和关键资产选择权；Mandate 门禁由数据库触发器 / RPC 强制执行。
7. Worker 负责可靠执行，异步任务必须幂等、可重试、可取消、有预算与轮次熔断并记录成本。
8. 去 Obsidian 化，云端 Postgres 为唯一运行时权威源，支持标准 Markdown 导入导出。
9. 所有正式产物都必须能追溯来源、版本、任务、模型、成本和人工审核。
10. 先验证单条真实链路，再增加抽象、模型和自动化。

## 工程目录

```text
signal-to-story/
├── sense-console/           # Web Console、Supabase 配置与后台执行 Worker
│   ├── src/                 # React 前端、契约、Harness 纯函数与服务层
│   ├── supabase/            # 迁移、RLS、Edge Functions、Seeds 与 SQL 测试
│   ├── video-factory/       # 既有 Python 视频引擎（P5 由 workers/video/ 封装）
│   ├── workers/             # 独立运行进程：agent/（Node）、video/（Python）
│   └── docs/                # 数据模型、API 字典、Harness 协议与接入说明
├── sense-site/              # 独立读者内容站（首版已实现，未部署，详见 sense-site/README.md）
├── knowledge-base/          # 默认知识库种子（通过 kb:seed 同步到 knowledge_entries；运行时权威是 Postgres）
├── docs-site/
│   ├── design/              # 产品需求文档（PRD）
│   ├── spec/                # 系统架构与内容方法论 SPEC
│   ├── plan/                # V2 统一架构规划、实施总计划与读者站建设计划
│   └── research/            # Agent Harness / 自循环外部研究归档
└── README.md
```

2026-11-15 决策：生成 ↔ 评估多轮循环超出 Edge Function 单请求时限，已在 `sense-console/workers/` 落地 Agent worker（`workers/agent/`，`npm run worker:agent`，纯出站进程，通过认领 RPC 反向拉取任务；视频 worker 为 `workers/video/`）。当前仍不创建 `packages/` 或 monorepo，只有 Web、Worker 确实需要跨工程共享版本化契约时再评估提升。Mandate/发布门禁由数据库触发器与 RPC 强制，前端检查只是 UX。

## 当前已交付基线（V1 已上线；V2 为代码完成、未部署）

1. **云端内容生产闭环**：信源分类（`source_categories`）、待处理信息（`signals`）、候选选题（`selections`）、内容项目与 Brief（`content_projects`）、Markdown 母稿与七平台稿（`content_documents`）、不可变版本历史（`content_revisions`）、并发冲突检测、人工审核记录（`content_review_events`）、人工发布排期与 24/48h 指标快照复盘（`content_publications` / `publication_metrics`）。数据字典见 [Cloud Content API](sense-console/docs/cloud-content-api.md)。
2. **统一外部收录网关**：`intake-gateway` Edge Function 支持受限 Bearer 令牌鉴权、幂等防重、限流与回执，控制台入口为「系统管理 → 外部接入」。接入说明见 [外部接入说明](sense-console/docs/external-intake.md)。
3. **Harness 契约与服务端内核（P1 / P2 / P1.5）**：
   - 双模驱动契约与纯函数引擎（`src/harness/`）、`knowledge-base/` 默认种子与标准 Markdown 导入导出；
   - 数据库 `agent_jobs` / `agent_job_steps`（`FOR UPDATE SKIP LOCKED` 认领，不用 pgmq）、`decision_memories`、`knowledge_entries`、`approval_requests` 与 Mandate 触发器/RPC、PGlite 全量迁移 + RLS 测试、`workers/agent/` 独立执行进程与 `content-draft` 入队模式。协议详见 [Agent Harness 内核](sense-console/docs/agent-harness.md)。

线上控制台入口：https://story.susense.cn/ 。以上 V2 能力（P1.5 起）尚未部署到线上：线上 migration 与知识库种子未应用，线上视频工坊页面仍为演示态。

## V2 演进路线（P1 ～ P7）

**状态（2026-11-15）：P1 ～ P7 全部为「代码完成、本地验证通过、线上未部署」**；验证仅在 PGlite 与假客户端上进行，真实 Supabase、真实 IM 联调、真实视频引擎、真实浏览器点测均未完成。已知断层见 [V2.0 实施总计划](docs-site/plan/v2-master-execution-plan.md) 文末。执行顺序：P1 → P2 → P1.5 → P3 → P6a → P4 → P5 → P6b → P7。

- **P3**：Web 极简速记入口（顶栏速记、Cmd/Ctrl+K、`/capture` 页）+ 「采集 ➔ 自动出稿待审」闭环，worker 抓取正文含 SSRF 防护；
- **P6a**：Decision Memory 回灌最小版（审核退回理由 / 复盘规则一键写入 `decision_memories` 并注入 Context Pack）；
- **P4**：飞书与企微 `im-webhook`、回执、待审通知卡片（按钮仅为跳转链接）。**IM 内一键批准未做**（缺 IM 用户与后台账号绑定），部分协议字段未对照官方文档，Deno 打包未验证，未真实联调；
- **P5**：视频工坊（`video_plans` / `video_shots`、分镜工作台、Python 视频 worker、付费渲染数据库级批准）。未做：关键帧上传/生成界面、云端 TTS、图形化多轨时间线、拖拽排序；
- **P6b**：发布到读者站需数据库级批准（请求 → 批准 → 发布），发布排期视图，改稿使旧批准与旧排期失效；排期只是计划记录，不自动发布；
- **P7**：独立读者内容站 `sense-site`（公开/注册可见性、专题、收藏、资源下载、演示模式），详见 [sense-site/README.md](sense-site/README.md) 与 [内容站建设计划](docs-site/plan/sense-site-plan.md)。

## 如何本地验收

以下命令均真实存在（于仓库根目录执行），不需要线上环境：

```bash
npm --prefix sense-console run demo:harness   # P1.5 任务队列、评估与 Mandate
npm --prefix sense-console run demo:capture   # P3 速记到待审
npm --prefix sense-console run demo:video     # P5 分镜与付费渲染批准
npm --prefix sense-site run dev:demo          # P7 读者站演示模式
npm --prefix sense-console run worker:agent   # 启动 Agent worker（需自备环境变量）
```

门禁命令：`typecheck`、`lint`、`test`、`build`（`npm --prefix sense-console run <命令>`）。逐项验收清单见 [V2 验收清单](docs-site/plan/v2-acceptance-checklist.md)（由 QA 编写）。未上线、未联调的部分不在本地验收范围内。

## 文档导航

### 规范与需求（`docs-site/`）
- [总体系统架构 SPEC](docs-site/spec/Signal-to-Story总体架构-SPEC.md)：控制面、状态层、执行面、资产存储、Mandate 门禁与任务闭环上位规范。
- [内容创作与 AI-CMS 指导 SPEC](docs-site/spec/内容创作与AI-CMS指导-SPEC.md)：个人 IP 定位、1+3+N 支柱、4A 视角、选题评分、平台适配与四道质量门禁。
- [内容站 SPEC](docs-site/spec/sense-site-SPEC.md) · [内容站 PRD](docs-site/design/sense-site-PRD.md)：独立读者内容站边界、发布快照与读者权限设计。
- [星火工厂产品需求文档（V2 统一基线）](docs-site/design/AI内容生产系统-PRD-v1.md)：已交付 V1 菜单/功能基线与 V2 核心模块需求（FR-01 ～ FR-06）。
- [V2 统一架构规划](docs-site/plan/v2-unified-architecture-plan.md) · [V2.0 实施总计划](docs-site/plan/v2-master-execution-plan.md)：四大方向整合架构、双模 Harness 与 P1～P7 施工路线及五道验证门禁。
- [内容站建设计划](docs-site/plan/sense-site-plan.md)：`sense-site` P0～P5 分阶段建设与验收方案。
- [Agent Harness 研究归档](docs-site/research/README.md)：理论输入与外部来源分析归档。

### 工程与数据库（`sense-console/docs/`）
- [Supabase 数据模型入口](sense-console/docs/supabase-data-model.md)：组织基座、资产账本、知识库与对象存储上传规范。
- [Cloud Content API 字典](sense-console/docs/cloud-content-api.md)：云端内容表、状态机、乐观并发、AI 草案与导出契约。
- [Agent Harness 内核（P1.5）](sense-console/docs/agent-harness.md)：`agent_jobs` 队列、Mandate 触发器、RPC、Harness 接口与知识库种子机制。
- [外部接入说明](sense-console/docs/external-intake.md)：`intake-gateway` 请求协议 v1、防重限流与部署配置。
- [前端规范](sense-console/docs/frontend-conventions.md) · [shadcn 基座](sense-console/docs/shadcn-foundation.md)：共享组件复用与 Base UI 约定。
