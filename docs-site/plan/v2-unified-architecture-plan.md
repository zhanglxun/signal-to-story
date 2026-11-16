# 星火工厂（Signal to Story）V2.0 统一架构升级与 SaaS 演进规划

> **状态**：架构设计文档。P1～P7 代码均已完成并通过本地验证，线上未部署（见第 6 节）；其中 `sense-runner` 三形态、工作区物化协议、`cli_session_id` 续接、租户密钥注入为「目标设计，未实现」，集中见第 7 节。  
> **更新日期**：2026-11-15  
> **修订说明（2026-11-15）**：阶段编号统一指向 [实施总计划](v2-master-execution-plan.md) 的 P1～P7（新增 P1.5）；pgmq 改为任务表队列；目录改为 `sense-console/workers/`；模型 ID 改为示例并以控制台配置为准；CLI 先只接通 Codex；SaaS 范围收敛；「方向 D」定义为独立读者站 `sense-site`。
> **核心目标**：将「控制台资产管理（`sense-console`）、读者展示站（`sense-site`）、Agent 自循环 Harness（方向 A）、多入口内容助手（方向 B）、Web 视频工坊与多平台发布（方向 C）、独立读者站（方向 D = `sense-site`）」收敛到一套**去 Obsidian 化、可独立服务端部署、支持云端大模型与本地/容器 Agent CLI 混合调度、保留 SaaS 演进余地（当前仅 `organization_id` + RLS）**的统一架构。

---

## 1. 核心结论：四大方向（A/B/C/D）为何互不冲突且可独立异构演进？

你提出的 5 个应用层与方向（A Harness、B 多入口、C 视频工坊、D 读者站 `sense-site`）不仅**完全不冲突**，而且在架构上恰好构成了**「一个内核、两个前端、三条业务流水线」**的正交矩阵：

| 维度 / 模块 | 架构角色定位 | 核心读写边界（基于同一套 Supabase 数据底座） | 独立演进方式 |
| :--- | :--- | :--- | :--- |
| **1. `sense-console`** | **控制面与生产工作台（B 端 / 创作者端）** | 读写全量租户资产：信源、选题、母稿、平台稿、视频分镜、任务队列、审核门禁、账号与权限 | 按模块独立迭代 UI，不跑长耗时任务 |
| **2. `sense-site`** | **消费面与品牌内容站（C 端 / 读者端）** | **只读**经人工批准并显式发布的不可变快照（`site_entries` / `site_entry_bodies`）与公开/受控媒体资产 | 独立 Vite SPA/SSR 部署，与后台代码零耦合 |
| **3. 方向 A：Agent Harness** | **智能编排与治理横切内核（大脑与护栏）** | 负责指令数据隔离、决定记忆（Decision Memory）、生成-评估自循环（Generator ↔ Evaluator）、人工批准门禁（Mandate） | 作为底层中间件演进，图文与视频共用同一套状态机 |
| **4. 方向 B：多入口助手** | **全渠道采集与交互网关（感知与触达层）** | 飞书、企微/微信、浏览器插件、网页极简入口统一转为标准 `IntakeEvent` 入库，并通过双向卡片回传待审通知 | 新增渠道只需增加一个轻量 Webhook/Adapter，不改核心管线 |
| **5. 方向 C：Web 视频工坊** | **多模态垂直生产引擎（视频流水线）** | 复用选题/脚本/资产库，新增结构化分镜 `video_plan` 与多轨合成任务，产物回写同一资产表并复用多平台发布引擎 | Python `video-factory` 封装为 `sense-console/workers/video/`，通过任务表队列与 Web 解耦 |

---

## 2. 关键架构决策：去 Obsidian 化、服务端独立部署与 SaaS 化

### 2.1 去 Obsidian 化（Cloud-Native Single Source of Truth）
- **权威数据源唯一化**：Postgres（文本、版本、结构化分镜、关系、审计）+ 对象存储（R2 / S3 / OSS / Supabase Storage）成为唯一权威事实源。
- **Markdown 仅作为导入/导出格式**：不再维护复杂的本地 Vault 同步协议，僅在页面提供标准的 `.md` / `.zip` 导入导出功能。系统在任何 Linux 云服务器上均可 100% 独立运行。

### 2.2 服务端主运行 + 本地电脑算力按需挂载（`workers/agent` 出站 worker）
- **标准服务端模式（Server-First）**：Web 前端、Supabase、Agent worker 分别部署；worker 是**纯出站进程**，通过 `FOR UPDATE SKIP LOCKED` 认领 RPC 拉取 `agent_jobs`，不需要公网 IP，不托管前端。关掉浏览器后，已入队任务照常推进到 `pending_review`；发布仍需人类批准。
- **现状**：只有一个启动命令 `npm run worker:agent`（位于 `sense-console/workers/agent/`）。部署与算力形态（合体单进程、个人电脑挂载）的多形态设计见第 7 节「目标设计，未实现」，当前**不存在**。
- **自带节点边界**：个人订阅的 CLI（如本机已登录的 Codex）只适用于自带节点模式、继承宿主机登录态，不得用于给多租户托管服务供能。
- **开发期本地桥**：Vite dev server 中的 `/__sense_bridge` 仅为开发期配置与连通性自测工具，带 loopback / Origin / Token 校验，生产不存在；正式任务队列由 worker 反向认领。

### 2.3 SaaS 演进余地（当前范围收敛）
- **当前只保留**：全表绑定 `organization_id`（已具备基础），RLS 按组织隔离；`sense-site` 通过 `site_id` 绑定对应组织。
- **推后**：计费、用量账单、租户自助入驻，推后到单条真实链路（采集 → 出稿 → 审核 → 发布）跑通之后再评估。
- **密钥存储统一**：目标：BYOK 密钥统一为**组织级 provider 配置（服务端加密存储）**；该配置表**尚未建设**，目前 worker 读自身环境变量（见第 7 节）。
- **算力模式（远期方向，非当前交付）**：平台托管算力 与 BYOK / BYO-Node 两种商业模式，待上述推后项启动时再设计。

---

## 3. 核心底层抉择：自研 Agent CLI，还是构建「Harness 中间层 + 多引擎适配层」？

针对你提出的第 4 点（参考 Pi / OpenCode，或调用本地 `codex` / `agy` / `pi` / `opencode` CLI，以及国内 Qwen / Kimi 系列，是否做中间层还是自造 Agent CLI），结论如下：

> [!IMPORTANT]
> **架构结论：不要从零自造通用底层 Agent CLI；应当自研「星火 Content Harness 中间层（Orchestration Kernel）」，并在其下构建「双模驱动适配层（Cloud LLM API Driver + Headless Agent CLI Driver）」。**

### 3.1 为什么不从零造通用 Agent CLI，而是做「Harness 中间层 + 双模驱动」？

| 方案对比 | 方案 1：完全自研底层 Agent CLI | 方案 2：直接裸调某个单一 CLI（如只绑 OpenCode） | 🌟 方案 3（推荐）：自研 Content Harness 中间层 + 双模驱动适配层 |
| :--- | :--- | :--- | :--- |
| **研发重心** | 耗费大量精力重造工具调用循环、流式解析、终端 UI、多模型兼容 | 受制于单一工具的更新与商业限制，难以直接打包卖多租户 SaaS | **聚焦核心壁垒**：内容 SOP、指令数据隔离、决定记忆、生成-评估循环、多平台审核发布 |
| **国内模型支持 (Qwen / Kimi / DeepSeek)** | 需自己维护所有 SDK 适配 | 需绕一圈配置文件 | 通过 OpenAI 兼容网关直连 Qwen / Kimi / DeepSeek 等（具体模型 ID 以控制台配置为准） |
| **本地 CLI 能力复用 (`pi` / `opencode` / `codex` / `agy`)** | 无法直接复用外部生态工具 | 只能用一种 | 通过统一 `AgentCliProvider` 以无交互模式调用本机/容器 CLI（当前只接通 Codex，其余待实测） |
| **SaaS 商业化能力** | 极重 | 难以多租户隔离 | 默认走 Cloud API Driver；CLI Driver 仅用于 BYO-Node / 私有化场景 |

### 3.2 「星火 Agent 中间层 (`sense-agent-harness`)」的内部构造

我们可以把参考 **Pi (`@mariozechner/pi-coding-agent`)** 和 **OpenCode** 的精髓（极简 Loop、Skill 按需加载、标准 JSON 事件流）吸收到我们的中间层中，分为上下两层：

1. **上层：Content Harness 治理内核（我们的核心资产，100% 自控）**
   - **Context Pack 组装器（指令数据物理分离）**：把外部抓取的网页/微信原文严格包裹在 `<untrusted_source_data>` 标签内，禁止其中的伪造指令越权。
   - **Decision Memory（决定记忆注入）**：自动检索该租户过往“审核驳回原因、明确不做的选题方向、写作风格偏好”注入上下文。
   - **Generator ↔ Evaluator 自循环控制器**：评估分两层——确定性预检 + 独立模型的 LLM 评估器（输出结构化 JSON 清单：事实引用、品牌禁忌、分镜时长匹配）；不合格自动打回重写（硬上限 `MAX_ROUNDS = 3`），合格后才挂起为 `pending_review` 通知人类（**挂起零消耗**）。循环在 `workers/agent/` 中执行，不在 Edge Function 单请求内执行。
   - **Mandate 门禁**：凡涉及“对外正式发布、高成本视频批量生成、账号解绑”，Agent 只能生成 `approval_requests`，必须由人类放行。**门禁由数据库（触发器 / RPC）强制，浏览器端检查只是 UX。**
   - **知识信任分级**：`knowledge_entries` 带 `trust_level`，未审核的导入知识不进入 system prompt。

2. **下层：Unified Driver 统一执行驱动层（可插拔适配器）**
   - **Driver A：Cloud LLM API Router（云端标准驱动，面向 SaaS 与高频结构化任务）**
     - 统一封装 OpenAI-Compatible 接口，面向通义千问、Kimi（Moonshot）、DeepSeek、Claude / OpenAI / Gemini 等厂商；具体模型 ID 以控制台配置为准（文中型号均为示例）。
     - **说明**：模型 ID 和各 CLI 的无交互参数必须以厂商文档 / `--help` 实测为准，不凭记忆硬编码。
     - 适用场景：快速意图分类、选题摘要、结构化分镜 `video_plan.json` 拆解、只读评估器打分。
   - **Driver B：Headless Agent CLI Bridge（CLI 驱动，复用外部最强 Agent 执行体）**
     - 由 worker 以子进程调用（现状：空临时目录 + 只读沙箱；「Workspace 任务包」物化为目标设计，未实现，见第 7 节）。
     - **当前只接通 Codex CLI**；Pi、OpenCode、Antigravity（`agy`）保留在驱动注册表，标注「未验证」，参数以实测为准后再启用。
     - **prompt 经 stdin 传入，不走 argv**（避免进程列表泄露与长度限制）。
     - CLI 只读写指定的任务输入/输出文件，不触碰生产数据库凭证。**「受限沙箱」只有在容器内运行才成立**；在个人电脑上直接运行时只是目录约定，不是隔离。
     - 个人订阅的 CLI 仅适用于自带节点（BYO-Node）模式，不用于给多租户托管服务供能。

### 3.3 后台自循环 Loop 的宿主（现状）
- **不在浏览器跑 Loop**：`Generator ↔ Evaluator（确定性预检 + 独立 LLM 评估，≤3 轮）` 循环由独立运行的 Node worker（`workers/agent/`，`npm run worker:agent`）掌控。浏览器关闭后，已入队任务照常推进直到产出 `pending_review` 提案。
- **CLI 驱动现状**：空临时目录 + 只读沙箱，prompt 走 stdin；worker 读自身环境变量。
- 原「工作区物化协议、Session 续接与密钥动态注入」设计已移至第 7 节，标注为「目标设计，未实现」。

---

## 4. 整体系统全景架构图（System Architecture）

```mermaid
flowchart TB
    %% 样式定义
    classDef client fill:#eff6ff,stroke:#3b82f6,stroke-width:1.5px,color:#1e3a8a
    classDef gateway fill:#fef3c7,stroke:#f59e0b,stroke-width:1.5px,color:#78350f
    classDef core fill:#f0fdf4,stroke:#22c55e,stroke-width:1.5px,color:#14532d
    classDef data fill:#f3e8ff,stroke:#a855f7,stroke-width:1.5px,color:#581c87
    classDef worker fill:#fff1f2,stroke:#f43f5e,stroke-width:1.5px,color:#881337

    subgraph Ingress["1. 全渠道触达与展现层 (Omnichannel & Presentation)"]
        direction LR
        IM["多入口助手 (方向 B)<br/>飞书 / 企微 / 微信 / 浏览器采集"]:::client
        Console["sense-console (控制面)<br/>资产管理 · 创作审核 · 视频工坊 · 复盘"]:::client
        Site["sense-site (消费面)<br/>独立读者站 · 专题资源 · 会员阅读"]:::client
    end

    subgraph APIGateway["2. 接入与安全边界层 (Supabase Edge & RLS Gateway)"]
        direction LR
        IntakeGW["intake-gateway<br/>统一验签 · 幂等去重 · 意图识别"]:::gateway
        DataAPI["Supabase Data API + RLS<br/>多租户行级隔离 · 快照只读"]:::gateway
        ApproveGW["mandate-gateway<br/>approval_requests · 数据库触发器/RPC 强制门禁"]:::gateway
    end

    subgraph StatePlane["3. 核心状态与资产关系层 (State & Storage Plane - SaaS Multi-Tenant)"]
        direction LR
        PG[("Supabase Postgres<br/>租户/信源/选题/母稿/分镜/任务/审计")]:::data
        Mem[("decision_memories · knowledge_entries<br/>租户偏好 · 驳回记忆 · 知识库 (trust_level)")]:::data
        Queue[["agent_jobs / agent_job_steps 任务表<br/>SKIP LOCKED 认领 · 幂等 · 跳数上限 · 预算控制"]]:::data
        OSS[("对象存储 (R2 / OSS / S3)<br/>图片 / TTS配音 / 万相视频 / 成片")]:::data
    end

    subgraph HarnessPlane["4. 智能编排与自循环内核 (方向 A: Sense Agent Harness)"]
        direction TB
        Dispatcher["规则路由器 (Fast Path)<br/>没事不唤醒模型 · 确定性过滤"]:::core
        CtxBuilder["Context Pack 组装器<br/>指令与外部数据物理隔离"]:::core
        AutoLoop["Generator ↔ Evaluator 循环器 (workers/agent)<br/>生成草案 ➔ 预检 + LLM 评估 (≤3轮) ➔ 挂起待审"]:::core
        
        subgraph Drivers["双模 Agent 驱动适配层 (Unified Agent Runtime)"]
            direction LR
            CloudLLM["Cloud LLM Driver (API 直连)<br/>Qwen · Kimi · DeepSeek · Claude (型号以配置为准)"]:::core
            CLIBridge["Agent CLI Driver<br/>Codex (已接通) · Pi / OpenCode / agy (未验证)"]:::core
        end
    end

    subgraph ExecutionPlane["5. 垂直生产与分发执行面 (方向 C: Media & Publish Workers)"]
        direction LR
        VideoWorker["workers/video (Python 封装 video-factory)<br/>Audio-First TTS · 云端视频模型 · 本地运镜 · 多轨混音"]:::worker
        PubWorker["Omnichannel Publisher (多平台发布器)<br/>X · 公众号 · 小红书 · 抖音 · 视频号 · sense-site"]:::worker
        LocalNode["本地算力节点 = workers/agent 的本机部署<br/>Outbound 反向认领 · 调用本机 CLI / GPU"]:::worker
    end

    %% 连线关系
    IM -->|Webhook / 分享输入| IntakeGW
    Console -->|受控 CRUD / 视频画布指令| DataAPI
    Console -->|审批 / 触发发布| ApproveGW
    Site -->|匿名 / 读者只读查询| DataAPI

    IntakeGW --> PG
    IntakeGW --> Queue
    DataAPI --> PG
    ApproveGW --> PG
    ApproveGW --> Queue
    ApproveGW -->|双向卡片回执| IM

    Queue -->|云端容器 worker 认领| Dispatcher
    Dispatcher --> CtxBuilder
    Mem -.->|注入租户偏好| CtxBuilder
    CtxBuilder --> AutoLoop
    AutoLoop --> CloudLLM
    AutoLoop --> CLIBridge
    LocalNode -.->|反向认领任务 (同一 worker 程序)| Queue
    LocalNode --- CLIBridge
    AutoLoop -->|写回 Proposal / 挂起待审| PG

    Queue --> VideoWorker
    VideoWorker <-->|读写音视频物料| OSS
    VideoWorker -->|回写分镜状态与成本| PG

    Queue --> PubWorker
    PubWorker -->|回传真实 URL 与 24/48h 指标| PG
```

---

## 5. 五层逻辑架构与模块划分详解

为了保证**“可独立构建、互不阻塞、随时可拆可合”**，整体工程划分为 5 个逻辑分层：

### 5.1 五层逻辑职责定义

1. **L1 触达与展现层（Presentation & Ingress Layer）**
   - **`sense-console`**：创作者与团队后台（React 19 + Tailwind + shadcn/ui）。
   - **`sense-site`**：面向外部读者的内容与资源站，只读已发布快照。
   - **`im-connectors`（方向 B）**：飞书应用机器人、企业微信机器人、网页极简速记框、浏览器采集插件。
2. **L2 网关与权限安全层（Gateway & Security Layer）**
   - 基于 Supabase Auth + Postgres RLS 实现多租户隔离（`organization_id`）。
   - `intake-gateway` 处理外部异构消息标准化与幂等去重；`mandate-gateway` 处理人类审批签名，并由数据库触发器 / RPC 强制校验（确保 Agent 无法自我批准发布或超额消费）。
3. **L3 状态、记忆与资产关系层（State, Memory & Asset Layer）**
   - **核心关系链**：`Source`（信源）→ `Signal`（线索）→ `Topic`（选题）→ `ContentProject`（立项）→ `Document/Revision`（图文母稿与平台稿） / `VideoPlan/Shot`（视频分镜脚本）→ `Asset`（对象存储媒体）→ `Release/Metric`（多平台与站点发布及复盘）。
   - **Decision Memory 表 (`decision_memories`)**：结构化记录人类每次通过/驳回时的理由与长期偏好。
4. **L4 智能编排与 Harness 内核层（Sense Agent Harness - 方向 A）**
   - 由 `sense-console/workers/agent/` 常驻 worker 承载（Edge Function 仅入队），实现：**规则前置过滤 → 安全上下文打包 → 生成器/评估器自循环（最多 3 轮）→ 挂起等待人类拍板**。
5. **L5 多模态执行与插件驱动层（Execution & Driver Layer - 方向 C & CLI 桥接）**
   - **Agent Runtime Drivers**：支持云端大模型 API（Qwen / Kimi / DeepSeek 等，以配置为准）与 CLI 驱动（先只接通 Codex，其余未验证）。
   - **Video Factory Service**：`sense-console/workers/video/`（Python）封装现有 `sense-console/video-factory/`，消费任务表中的任务（单镜头 TTS 试听、单镜头云端视频模型重抽、全片 FFmpeg 合成并上传对象存储）。
   - **Publish Connectors**：X API、微信公众号草稿/发布 API、以及 `sense-site` 站内快照发布事务。

---

### 5.2 目录结构演进规划（无 monorepo，无 `packages/`）

在保留现有成果的基础上，工程结构平滑演进（无须推翻重写）。`workers/agent/`（P1.5）与 `workers/video/`（P5）已创建；根目录 `knowledge-base/` 是默认种子，运行时权威是 Postgres。

```text
signal-to-story/
├── sense-console/                  # [应用1] 创作者控制面 (React + Vite)
│   ├── src/
│   │   ├── pages/                  # 内容中心、视频工坊、审核中心、任务中心
│   │   ├── components/
│   │   ├── services/               # Supabase Data API 与动作触发服务
│   │   └── contracts/              # 前端当前使用的类型契约（不提升为 shared package）
│   ├── supabase/                   # Migrations、RLS、Edge Functions、数据库测试
│   │   ├── migrations/             # agent_jobs、decision_memories、knowledge_entries、approval_requests 等
│   │   └── functions/              # intake-gateway、content-draft（仅入队）、im-webhook、site-publish
│   ├── video-factory/              # 既有 Python 视频引擎（由 workers/video 封装）
│   └── workers/                    # 独立运行、独立部署的后台进程
│       ├── agent/                  # Node worker：认领 agent_jobs，跑 Generator ↔ Evaluator；
│       │                           #   云端容器 = Agent Runtime，个人电脑 = 本地算力节点
│       └── video/                  # Python worker：封装 video-factory（P5）
├── sense-site/                     # [应用2] 独立读者内容站（首版已实现，未部署，P7）
├── knowledge-base/                 # 默认种子（导入 knowledge_entries）；非运行时权威
└── docs-site/                      # 架构规范、PRD 与演进计划
```

---

## 6. 分阶段落地路线图（映射到 P1～P7）

阶段编号以 [V2.0 实施总计划](v2-master-execution-plan.md) 为唯一准，本文不再维护第二套编号。**执行顺序**：P1 → P2 → P1.5 → P3 → P6a → P4 → P5 → P6b → P7。

| 阶段 | 内容 | 对应方向 | 状态 |
| :--- | :--- | :--- | :--- |
| P1 | Harness 契约与纯函数（Context Pack、评估循环、Mandate 检查、驱动注册表） | A | 已完成 |
| P2 | 去 Obsidian 化：知识库种子 + Markdown 导入导出 | A | 已完成（纯函数） |
| P1.5 | Harness 内核服务端落地：`agent_jobs` 队列、`workers/agent/`、`decision_memories` / `knowledge_entries` / `approval_requests`、数据库 Mandate 门禁、两层评估器、`content-draft` 入队、PGlite 测试 | A | 代码完成，本地验证通过，线上未部署 |
| P3 | Web 极简速记入口 + 采集 → 出稿待审闭环 | B | 代码完成，本地验证通过，线上未部署 |
| P6a | Decision Memory 回灌最小版 | A | 代码完成，本地验证通过，线上未部署 |
| P4 | 飞书（TOP 1）+ 企业微信（TOP 3）IM 通道、回执与待审通知卡片 | B | 代码完成，未联调；按钮仅为跳转链接，IM 内一键批准未做（缺身份绑定） |
| P5 | Web 视频工坊 + `workers/video/` | C | 代码完成，本地验证通过，线上未部署；关键帧界面、云端 TTS、多轨时间线、拖拽排序未做 |
| P6b | 图文 + 视频统一多平台发布排期与复盘 | C | 代码完成，本地验证通过，线上未部署 |
| P7 | `sense-site` 读者站 + 部署封装（计费与租户自助入驻推后） | D | 代码完成，本地验证通过，线上未部署 |

> 方向 D 即独立读者站 `sense-site`，其自身的 P0～P5 子阶段见 [sense-site 建设计划](sense-site-plan.md)，不与本表 P 编号混用。

---

## 7. 目标设计，未实现

以下内容曾被写成已具备的能力，但**代码中不存在**，仅作目标设计保留。

- **a. `sense-runner` 三形态**（开发态、`npm run start` 单进程托管前端并跑循环、`npm run runner` 个人电脑挂载）。*差异*：实际只有 `npm run worker:agent`，worker 是纯出站进程，不托管前端。
- **b. 工作区物化协议**：认领后在 `/workspaces/job_<id>/` 生成 `TASK.md`、`MEMORY.md`、`inputs/`，CLI 写 `outputs/draft.md` 后归档。*差异*：实际 CLI 驱动使用空临时目录 + 只读沙箱 + prompt 走 stdin；只读沙箱下无法写 `outputs/`，若要做需重新设计安全模型。
- **c. `cli_session_id` 与 `--resume` 续接会话**。*差异*：不存在；现有 `resume_agent_job` 指任务重新排队并增加轮次，是另一回事。
- **d. 每次任务向子进程注入租户 API Key**（组织级 provider 配置加密存储）。*差异*：该配置表未建，worker 读自身环境变量；BYOK 加密存储与按组织签发的受限 worker 凭证均未做。

## 8. 已知断层与未验证项

1. 线上 migration（20261115 及之后）与知识库种子尚未应用。
2. 真实 Supabase 的 PostgREST / Storage / Auth 行为未验证，目前只在 PGlite 与假客户端上验证。
3. Edge Function 的入队模式与 `im-webhook` 的 Deno 打包未实测。
4. Codex 未真实调用；pi / opencode / agy 的无交互参数未验证。
5. worker 使用 `service_role`（数据库最高权限），在个人电脑节点上有凭证风险；按组织签发的受限凭证未实现。
6. IM 用户与后台账号的身份绑定未设计，因此 IM 内不能直接批准。
7. 飞书 / 企微部分协议字段未对照官方文档、未联调。
8. 视频真实引擎（TTS、云端视频模型、全分辨率合成）与真实计费未验证。
9. Dot 手机端接入一直未验收。
10. 各页面未在真实浏览器里点测过，只有编译加载与组件测试。

## 9. 待负责人决定

仅列问题与总架构师建议，不替负责人决定。

1. **物化协议与会话续接是否要做？** 建议暂不做。
2. **预算口径**：旧文档「不设硬预算、只记 token」与 V2 已实现的预算熔断不一致。建议以 V2 为准。
3. **已删除的 `frame-work.md` 中的 Supabase 安全验收清单**是否并入 `sense-console/docs/supabase-data-model.md`？建议并入。
