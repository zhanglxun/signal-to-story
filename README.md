# 星火工厂 · Signal to Story

星火工厂（Signal to Story）是一个面向个人内容生产与 AI 协作的 **Content Ops 控制系统**。

它把信息源、线索、选题、内容项目、任务、故事、脚本、分镜、人物、场景、媒体资产、发布记录和复盘数据组织成一个可查询、可审核、可追踪的生产系统。

产品中文名统一为 **星火工厂**，英文名为 **Signal to Story**；中英文组合展示名为 **星火工厂 · Signal to Story**。Web 工程目录名保留为 `sense-console`，企业及版权标识暂用 `susesne.cn`。

## 核心定位

> 星火工厂控制台（Signal to Story Console）是内容生产系统的控制面和资产关系可视化中心；Supabase 管理运行状态、关系与审计；Agent 和 Worker 在后台异步完成认知及媒体生产；原始媒体物料保存在独立对象存储中。

| 组成 | 主要职责 |
| --- | --- |
| `sense-console` | 驾驶舱、内容与任务可视化、指令下达、审核和资产关系查询 |
| Supabase | Auth、Postgres、Data API、任务状态、关系、审计及可选 Storage/Queue |
| AI Agent | 信息收集、分析、选题、Brief、草稿、脚本和分镜 Proposal |
| Worker | 模型调用、轮询、下载、上传、转码、渲染、重试和状态回写 |
| 对象存储 | 图片、音频、视频、字幕和其他原始二进制物料 |
| 云端内容工作室 | 在线母稿、平台版本、审核与发布记录的主存储 |
| Obsidian Vault | 独立本地创作方式，可接收显式导出的 Markdown |

## 核心原则

1. Console 管控制与展示，不承担长时间任务。
2. Supabase Postgres 管状态和关系，不存放大型二进制文件。
3. 对象存储管原始物料，数据库保存可审计的元数据和关系。
4. 前端可通过 Supabase SDK 完成受 RLS 保护的普通 CRUD，不建设传统后台 API。
5. 服务端 Secret、Webhook、强校验和受控 Agent 接口使用 Edge Functions 或可信执行环境。
6. Agent 提交 Proposal/Draft，人类保留批准、发布和关键资产选择权。
7. Worker 负责可靠执行，异步任务必须可重试、可取消、可追踪并记录成本。
8. 在线创作以平台云端存储为主；Obsidian 可独立使用，平台不静默覆盖本地文件。
9. 所有正式产物都必须能追溯来源、版本、任务、模型、成本和人工审核。
10. 先验证单条真实链路，再增加抽象、模型和自动化。

## 工程目录

当前工程代码统一放在 `signal-to-story/sense-console/`：

```text
signal-to-story/
├── sense-console/           # Web Console、Supabase 配置及后续执行入口
│   ├── src/
│   ├── supabase/
│   ├── docs/
│   └── workers/             # 出现真实长任务后再创建
├── docs-site/
│   ├── design/
│   ├── plan/
│   └── spec/
└── README.md
```

当前不创建 `packages/` 或 Worker。只有 Web、Worker、本机同步器确实需要共享契约时，才将 `sense-console/src/contracts/` 提升为共享 package。

## 最终目标与任务路线

以 IM、分享快捷操作和浏览器采集作为日常入口：随手发来来源或想法，云端自动处理到待审核；人类批准具体版本和账号后，由发布服务执行并回传结果。Web 保留为编辑、资产、任务与权限控制台，后台任务独立运行。

详见 [多入口个人内容助手任务路线图](docs-site/plan/personal-content-agent-roadmap.md)。这是后续实施目标，不代表 IM 或自动发布已上线。线上入口为 https://story.susense.cn/ 。

## 外部助手接入

统一接入层支持外部助手发送文字和链接，原子保存信源并形成候选选题；支持回执、防重和撤销。控制台入口：系统管理 → 外部接入。当前方案为 Dot 云端直接调用 HTTPS 收录 API，不使用插件或个人 Mac。手机端尚未验收，进度与阻碍统一记录在 [Dot 云端接入任务](docs-site/plan/dot-cloud-intake.md)。

部署及首次连接见 [外部接入说明](sense-console/docs/external-intake.md)。本阶段只收录到选题池，自动创作是下一阶段。

## 当前阶段

2026-10-06 首版采用云端内容创作与人工发布闭环：

- 线索与选题立项、在线内容项目和 Markdown 母稿。
- 不可变版本历史、多人编辑冲突检测、人工提审与审核。
- 文字 AI 草案提案，由人工采纳后保存与审核。
- 视频号、公众号、小红书、抖音、X、YouTube、Reddit 的账号登记与平台稿件。
- 审核版本导出、人工发布记录、指标快照与复盘。
- 视频生成单独建设；现有视频页面仍为演示，内容项目提供脚本与素材交接包。

具体范围见 [云端内容 MVP](docs-site/plan/cloud-content-mvp.md)，数据字典与接口见 [Cloud Content API](sense-console/docs/cloud-content-api.md)。

## 文档导航

- [总体系统架构 SPEC](docs-site/spec/Signal-to-Story总体架构-SPEC.md)：控制面、状态层、执行面、资产存储和任务闭环的上位规范。
- [内容系统分层与 Obsidian 单向同步 SPEC](docs-site/spec/内容系统分层与Obsidian单向同步-SPEC.md)：知识正文、导入协议、版本和冲突规则。
- [内容创作与 AI-CMS 指导 SPEC](docs-site/spec/内容创作与AI-CMS指导-SPEC.md)：个人定位、内容方法、生命周期和质量门禁。
- [AI 内容生产系统 PRD](docs-site/design/AI内容生产系统-PRD-v1.md)：产品范围、功能需求和里程碑。
- [Console 框架搭建计划](docs-site/plan/frame-work.md)：`sense-console` 前端与 Supabase 基座实施计划。

数据库表、字段、关系、状态机、RLS、Data API 暴露和 Storage Policy 后续单独维护在：

```text
sense-console/docs/supabase-data-model.md
```
