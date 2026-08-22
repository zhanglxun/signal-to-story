# Signal to Story

Signal to Story 是一个面向个人内容生产与 AI 协作的 **Content Ops 控制系统**。

它把信息源、线索、选题、内容项目、任务、故事、脚本、分镜、人物、场景、媒体资产、发布记录和复盘数据组织成一个可查询、可审核、可追踪的生产系统。

产品展示名统一为 **Signal to Story**，Web 工程目录名保留为 `sense-console`，企业及版权标识暂用 `susesne.cn`。

## 核心定位

> Signal to Story Console 是内容生产系统的控制面和资产关系可视化中心；Supabase 管理运行状态、关系与审计；Agent 和 Worker 在后台异步完成认知及媒体生产；原始媒体物料保存在独立对象存储中。

| 组成 | 主要职责 |
| --- | --- |
| `sense-console` | 驾驶舱、内容与任务可视化、指令下达、审核和资产关系查询 |
| Supabase | Auth、Postgres、Data API、任务状态、关系、审计及可选 Storage/Queue |
| AI Agent | 信息收集、分析、选题、Brief、草稿、脚本和分镜 Proposal |
| Worker | 模型调用、轮询、下载、上传、转码、渲染、重试和状态回写 |
| 对象存储 | 图片、音频、视频、字幕和其他原始二进制物料 |
| Obsidian Vault | 深度研究、原稿、脚本和创作过程的主编辑来源 |

## 核心原则

1. Console 管控制与展示，不承担长时间任务。
2. Supabase Postgres 管状态和关系，不存放大型二进制文件。
3. 对象存储管原始物料，数据库保存可审计的元数据和关系。
4. 前端可通过 Supabase SDK 完成受 RLS 保护的普通 CRUD，不建设传统后台 API。
5. 服务端 Secret、Webhook、强校验和受控 Agent 接口使用 Edge Functions 或可信执行环境。
6. Agent 提交 Proposal/Draft，人类保留批准、发布和关键资产选择权。
7. Worker 负责可靠执行，异步任务必须可重试、可取消、可追踪并记录成本。
8. Obsidian 是原稿主编辑端，CMS 只接收单向快照，不静默反向覆盖。
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

## 当前阶段

当前优先建设：

- React + shadcn/ui Base UI 的 `sense-console` 工程基座。
- Supabase 邮箱和密码登录、RLS 边界及数据访问层。
- 轻量 AppShell、两层以内菜单、驾驶舱、列表和详情页面模式。
- Agent Contract、幂等、审计和安全约定。
- 独立数据库模型设计文档。

当前不建设完整 Agent 编排平台、Media Worker、自动发布系统、三级菜单或 Obsidian 双向同步。

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
