---
title: 星火工厂（Signal to Story）产品需求文档（V2 统一基线）
aliases:
  - AI Content Factory PRD
  - Content Ops CMS PRD
  - 内容系统 PRD
type: prd
status: active
version: 2.0.0
owner: Jarvis
created: 2026-08-20
updated: 2026-11-15
tags:
  - Signal-to-Story
  - PRD
  - Content-Ops
  - Agent-Harness
  - Supabase
  - Video-Studio
---

# 星火工厂（Signal to Story）产品需求文档（V2 统一基线）

> **基线说明（2026-11-15）**：本文融合已交付的 V1 云端内容生产 MVP 与 V2 四大核心方向（A：Agent Harness、B：多入口采集助手、C：Web 视频工坊、D：`sense-site` 独立读者站），取代历史“Obsidian 主编辑 + 单向导入”旧版方案。
>
> 配套文档：[总体系统架构 SPEC](../spec/Signal-to-Story总体架构-SPEC.md) · [内容创作指导 SPEC](../spec/内容创作与AI-CMS指导-SPEC.md) · [V2 统一架构规划](../plan/v2-unified-architecture-plan.md) · [V2.0 实施总计划](../plan/v2-master-execution-plan.md)

---

## 1. 产品定位与核心原则

**星火工厂（Signal to Story）** 是一个面向个人与小团队内容生产、AI 协作的 **Content Ops 控制系统**。

- **云原生唯一权威数据源（Single Source of Truth）**：彻底去 Obsidian 化。在线母稿、不可变版本、结构化分镜、知识库（`knowledge_entries`）、决定记忆（`decision_memories`）、任务队列与审计全部由 Supabase Postgres 持久化管理；图片、音频、视频、字幕等原始二进制物料保存在独立对象存储。仓库根目录 `knowledge-base/` 作为默认知识库种子，系统支持标准 Markdown 的显式导入与导出。
- **控制面与执行面分离**：Web 控制台（`sense-console`）只做资产可视化、在线编辑、任务下达、审核拍板与复盘；所有长耗时 AI 生成循环与视频渲染均通过 Postgres 任务队列（`agent_jobs`）交由独立后台进程（`sense-console/workers/`）执行。
- **人类保留最终决定权（Mandate 门禁）**：AI 与 Worker 只能生成 `Proposal`、草稿或等待审批的请求；正式发布、高额视频渲染、账号与权限变更由数据库触发器 / RPC 强制要求人类 `approval_requests` 签名放行，浏览器端检查仅作 UX 提示。

### 1.1 目标内容类型与分发渠道

- **核心内容类型**：企业 AI 解说、图文知识拆解、故事/漫剧。视频项目默认目标 300 秒、9:16（可按需调整）。
- **多平台分发渠道**：微信公众号、视频号、小红书、抖音、X、YouTube、Reddit，以及自有独立读者站 [`sense-site`](sense-site-PRD.md)。
- **组织与协作角色**：按 `organization_id` 隔离（RLS 强制）。`Owner / Admin` 可编辑、审核、发布与批准高风险任务；`Member` 可编辑与提审；`Viewer` 只读。允许有审核权限的作者自审，所有审核动作留痕可审计。

---

## 2. 控制台信息架构（已交付 V1 基线）

采用两层导航结构：**一级业务模块 → 不可点击分组标题 → 二级可点击页面**，共 5 个一级模块、10 个分组、22 个页面（菜单配置维护于 `sense-console/src/config/navigation.json`）：

```text
星火工厂
├─ 工作台
│  └─ 工作台：创作总览
├─ 内容中心
│  ├─ 收集与选题：待处理信息、选题、分类管理
│  ├─ 创作与审核：内容项目、审核中心、内容生产流程
│  ├─ 素材与模板：素材资产、提示词与图例
│  └─ 发布运营：发布计划与记录、渠道与账号（P7 扩展站点发布）
├─ 视频工坊
│  ├─ 视频制作：剧本构造、分镜设置、角色设定、场景建模、画布创作
│  └─ 任务与监控：任务中心
├─ 数据复盘
│  └─ 数据复盘：数据与复盘
└─ 系统管理
   ├─ 账号与权限：组织与账号、角色管理
   └─ 系统配置：系统设置、外部接入
```

> 注：视频工坊内的既有原型入口在 P5 实装前保持演示标识，由 `workers/video/` 接管真实任务消费后逐页切换为生产工作台。

---

## 3. 核心业务对象与生命周期

### 3.1 端到端数据血缘

```text
Source（信源）
  → Signal（原始线索 / 外部采集回执）
    → Selection / Topic（候选选题）
      → ContentProject（内容立项与 Brief）
        ├─→ ContentDocument / ContentRevision（母稿与多平台原生稿、不可变版本）
        │     ↔ AgentJob / ContentAiProposal（Harness 自循环提案）
        ├─→ VideoPlan / VideoShot（结构化分镜与声音配置）
        │     ↔ AgentJob / Assets（单镜 TTS / 视频片段 / 成片，存对象存储）
        └─→ ApprovalRequest（Mandate 人类放行签名）
              → ContentPublication / SiteEntry（外部平台发布或读者站快照上线）
                → PublicationMetric / Retrospective（24/48h 指标快照）
                  → DecisionMemory（长期创作偏好回灌）
```

### 3.2 核心状态机

- **稿件审核与版本状态机**（详见 `sense-console/docs/cloud-content-api.md`）：
  `draft / changes_requested → in_review → approved / changes_requested`
  任意状态下修改标题或正文 → 自动生成新不可变 `revision` 并重置为 `draft`，同时数据库触发器使旧版本上未完成的排期与 `approval_requests` 自动失效（`expired`）。
- **后台任务状态机**（详见 `sense-console/docs/agent-harness.md`）：
  `queued → running → pending_review → succeeded | failed | cancelled`，以及超过轮次/跳数/预算或 Mandate 失效时的 `blocked_needs_human → queued`（人工恢复）。

---

## 4. 功能需求（FR-01 ～ FR-06）

### FR-01：全渠道采集与选题池（方向 B）

- **已交付**：分类管理（两层树形 `source_categories`）、待处理信息（`signals`）、候选选题（`selections`）、外部接入网关（`intake-gateway` Bearer 令牌鉴权、防重、限流与回执）。
- **V2 演进（P3 / P4）**：
  - **Web 极简速记入口**：全局快捷键（`Cmd+K`）/ 顶栏速记框 + iOS 快捷指令配置，支持 `capture_only`（仅收录入选题池）与 `auto_draft`（原子立项并入队出稿到待审）；
  - **IM 双向通道**：优先接入 **飞书自建应用机器人** 与 **企业微信机器人**，支持随手转发链接/灵感入库，以及在 IM 内接收待审交互卡片（支持「通过」「退回带理由」「通过并发布」）。
  - **安全约束**：所有外部输入与抓取正文必须视为不可信数据，严禁跨权触发制作、审核或发布。

### FR-02：云端内容工作室与不可变版本（已交付核心基线）

- **在线母稿与平台稿**：支持在控制台创建内容项目 Brief，撰写 Markdown 母稿并显式派生各平台原生稿件（母稿更新不隐式覆盖已派生的平台稿）。
- **版本不可变与并发保护**：每次保存通过触发器生成不可变 `content_revisions`；基于 `revision` 与 `status` 的乐观锁检测并发修改冲突。
- **标准 Markdown 导入/导出**：支持将外部 `.md` 文件（自动转换 Obsidian Wiki 链接语法，渲染层通过 `markdown-it` 禁用原始 HTML）导入为知识条目或稿件草稿；支持将稿件、Brief、复盘与视频交接 JSON 导出。

### FR-03：Sense Agent Harness 智能编排内核（方向 A）

- **Context Pack 安全组装**：System 区仅注入受控 SOP、匹配的 `decision_memories` 与 `trust_level = trusted` 的 `knowledge_entries`；外部信源与未审核导入知识强制隔离在 `<untrusted_source_data>` / `<untrusted_reference_knowledge>` 标签内。
- **Generator ↔ Evaluator 两层自循环**：
  - 在 `sense-console/workers/agent/`（Node 常驻 worker，支持云端容器与本机 BYO-Node 反向认领两种部署形态）中消费 `agent_jobs`；
  - 每轮执行 `生成 → 确定性预检（防注入泄漏、篇幅、禁用词、平台格式） → 独立模型 LLM 评估`；评估不过自动重写（硬上限 `MAX_ROUNDS = 3`），通过后写入 `content_ai_proposals` 并挂起为 `pending_review`（挂起零消耗），超限则停放为 `blocked_needs_human`。
- **双模驱动适配层**：
  - **Cloud LLM API Driver**：统一 OpenAI 兼容协议对接 Qwen、Kimi、DeepSeek、GLM 等国内主流模型与海外模型（模型 ID 与密钥均在组织级服务端配置，禁止硬编码）；
  - **Headless Agent CLI Driver**：通过工作区物化协议（`Checkout → stdin 执行与 --resume 续接 → Commit`）调用本地/容器 CLI（当前已验证接通 `codex-cli`，`pi/opencode/agy` 保留未验证标识）。
- **Decision Memory 回灌（P6a）**：审核退回理由或复盘页确认的“长期改进规则”经人工勾选写入 `decision_memories`，按租户、平台和内容形式自动注入后续 Context Pack。

### FR-04：数据库强制 Mandate 人工门禁

- **高风险操作显式审批**：涉及对外正式发布（`publish_external`）、读者站上线（`publish_site`）、付费/高额视频生成（`video_render`）、权限与凭证变更的操作，Agent 或 Worker 只能创建 `approval_requests`。
- **数据库层不可绕过**：数据库触发器 `agent_job_mandate` 与 RPC `decide_approval_request` 校验调用方必须是已登录的人类成员且具备对应权限（`content.publish` / `agent.approve` / `account.manage`），`service_role` 无法自行放行；目标对象版本号变化时旧批准自动作废。

### FR-05：Web 视频工坊与混合渲染（方向 C，P5）

- **可视化分镜画布**：大纲通过 `agent_jobs` 拆解为结构化 `VideoPlan` / `VideoShot` 卡片流，支持关联角色资产（Character Bank）锁定跨镜形象、在线修改旁白、切换配音音色、试听单句 TTS。
- **冷热混合渲染调度**：`sense-console/workers/video/`（Python）封装 `video-factory`，概念图与静态插画走本地 `LocalKenBurns` 平滑运镜（零生成成本），高动态镜头按需触发云端视频生成模型（支持单镜独立重抽）；多轨合成（旁白主时钟 + SFX 拟音 + BGM Ducking）与成片归档到冷层对象存储，资产库保留单次成本账本与签名 URL 在线预览。

### FR-06：多平台发布排期、复盘与读者内容站（P6b / P7）

- **统一发布排期与复盘**：支持登记真实平台账号，仅允许选择同平台且已批准最新版本的图文或视频资产创建发布计划；人工发布后回填真实 URL 与发布时间，系统生成 24h / 48h 观察窗口以录入指标快照与单变量复盘结论（未知指标留空，不跨平台硬合算曝光/阅读）。
- **独立读者内容站 `sense-site`（方向 D，P7）**：同级独立 Vite 前端，共用 Supabase 数据底座但严格隔离后台组织表；仅通过受控快照发布事务将人工批准版本写入 `site_entries` / `site_entry_bodies`，支持游客公开阅读、注册读者阅读、收藏、专题浏览与鉴权资源下载。详见 [sense-site PRD](sense-site-PRD.md) 与 [sense-site SPEC](../spec/sense-site-SPEC.md)。

---

## 5. 非功能与安全红线

1. **浏览器端边界**：前端仅持有 `VITE_SUPABASE_URL` 与 publishable key，严禁暴露 `service_role`、数据库密码或模型 Provider API Key；不在浏览器内运行长时间循环或媒体处理。
2. **多租户隔离**：所有业务表、任务队列、记忆与审批表均绑定 `organization_id` 并启用 Postgres RLS 与显式 `GRANT`；跨组织引用通过复合外键在数据库层拦截。
3. **可追溯与成本审计**：所有 Agent 与媒体任务必须携带幂等键、尝试次数、输入版本、执行器/模型标识、Token 或估算成本与人工审核记录；计费类失败绝不盲目自动重试。
4. **交付验证门禁**：每次变更必须通过 `typecheck + lint + test + build` 四道前端/契约门禁；涉及数据库结构或权限变更时必须通过 PGlite 全量迁移 + RLS 测试及行为级端到端验收。