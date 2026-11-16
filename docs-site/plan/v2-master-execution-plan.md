# 星火工厂（Signal to Story）V2.0 实施总计划（P1 ～ P7）与验证机制

> **更新日期**：2026-11-15  
> **状态（2026-11-15）**：P1 ～ P7（含 P1.5、P6a/P6b）均为「代码完成、本地验证通过、线上未部署」；P4 另有未完成项（见该阶段）。线上 migration 与知识库种子尚未应用，真实 Supabase 环境未验证，详见文末「已知断层与未验证项」。每阶段完成必须通过自动化自测门禁  
> **修订说明（2026-11-15）**：阶段编号以本文件为唯一准；新增 P1.5「Harness 内核服务端落地」；路线顺序调整为 P1 → P2 → P1.5 → P3 → P6a → P4 → P5 → P6b → P7；目录改为 `sense-console/workers/`；模型 ID 不再硬编码；CLI 驱动先只接通 Codex；验证门禁补第五道（数据库迁移 + RLS 测试）。P1、P2 已完成的是契约与纯函数，服务端落地见 P1.5。

---

## 一、 已敲定的四大核心架构前提

1. **双模 Agent 驱动中间层（Sense Agent Harness + Unified Runtime）**：
   - **通道 1（云端直连 API）**：统一 OpenAI 兼容协议直连国内主流模型厂家（通义千问 Qwen、月之暗面 Kimi、DeepSeek、智谱 GLM、MiniMax / 豆包 等）及海外模型。具体模型 ID 以控制台「模型配置」为准，本文出现的模型名仅为示例。
   - **通道 2（本地/容器 Agent CLI 桥接）**：通过统一的子进程协议调用 CLI。**当前只接通 Codex CLI（`codex`）一个**；Pi、OpenCode、Antigravity（`agy`）保留在驱动注册表中，标注「未验证」，实测通过后再启用。
   - **说明**：模型 ID 和各 CLI 的无交互参数必须以厂商文档 / `--help` 实测为准，不在代码或文档中凭记忆硬编码。
2. **去 Obsidian 化 + 项目内建知识库（Knowledge Base）**：
   - 解耦 Obsidian 桌面端，云端数据库为唯一权威状态源。
   - 支持 **Markdown 标准导入/导出**。仓库根目录 `knowledge-base/` 定位为**默认种子**（导入到 `knowledge_entries` 表），运行时唯一权威是 Postgres；用于沉淀领域背景、写作 SOP、品牌语料，决定记忆（Decision Memory）存于 `decision_memories` 表。
3. **方向 B 多入口策略：先做「Web 极简速记入口」，再按难易度接入 1～2 个最简 IM 通道**。
4. **严格自测与自动化验证门禁**：每个阶段交付时，必须自带单元测试/集成测试并通过 `typecheck + lint + test + build` 四道门禁，涉及数据库时再加第五道「迁移 + RLS 测试」，并附一条行为级端到端验收（见第四节）。
5. **SaaS 范围收敛**：当前只保留 `organization_id` + RLS 隔离；计费、租户自助入驻推后到单条真实链路跑通之后。
6. **Mandate 门禁由数据库强制**：发布、高额视频生成、权限变更等放行规则下沉到数据库（触发器 / RPC），浏览器端检查只是 UX，不算门禁。

---

## 二、 IM 与外部采集通道「接入难易度」排序（由易到难）

为了让你用最小配置成本跑通手机/桌面随手发内容，我们将主流入口按**“无须繁琐企业资质备案、开发调试最快、支持双向回执/卡片”**从易到难排序如下：

| 排名 | 入口通道 | 接入难度 | 核心优势与适用场景 | 前置条件与限制 | 推荐策略 |
| :---: | :--- | :---: | :--- | :--- | :--- |
| **TOP 0** | **Web 极简速记框（Quick Capture Bar + 手机 PWA 快捷页）** | ⭐ 极易（0 外部依赖） | 打开网页或命令面板（`Cmd+K`）粘贴链接/一句话即刻入库并可勾选“立即自动出稿”；手机浏览器添加到主屏幕即可当 App 用 | 仅需登录现有控制台账号 | **【P3 必做首发】** 零第三方审核，100% 稳定兜底 |
| **TOP 1** | **飞书自建应用机器人（Feishu Bot - 长连接/Webhook 模式）** | ⭐⭐ 最容易（国内首选） | **个人免费创建企业即可开自建应用**；支持 WebSocket 长连接（甚至无需公网固定 IP 备案即可收消息）、原生支持**交互式审批卡片**（在飞书直接点「通过并发布」） | 飞书开放平台后台点选权限（约 10 分钟配置） | **【P4 首推第 1 个 IM】** 交互卡片能力最强、开发最顺畅 |
| **TOP 2** | **Telegram Bot / Discord Bot** | ⭐⭐ 极易（海外/极客首选） | `@BotFather` 1 分钟拿到 Token，天然支持 Inline Keyboard 审批按钮、链接预览与语音/文件直接转发 | 需网络环境支持 | **【P4 备选】** 若日常用 TG/Discord，半小时即可接通 |
| **TOP 3** | **企业微信智能机器人 / 自建应用（WeCom）** | ⭐⭐⭐ 中等 | 可在「个人微信 → 企业微信通知」或企微 App 中直接使用；官方提供 `aibot-node-sdk` 与回调接口 | 自建应用接收外部消息需配置可信域名/IP 白名单 | **【P4 首推第 2 个 IM】** 适合习惯微信生态的日常使用 |
| **TOP 4** | **iOS 快捷指令（Shortcuts） / 浏览器一键书签（Bookmarklet）** | ⭐⭐ 容易（单向极速） | 在手机微信/小红书/浏览器点「系统分享 → 发送到星火工厂」，直调 `intake-gateway` Bearer API 并弹窗显示回执 | 仅单向提交 + 弹窗回执，审批需跳网页或飞书 | **【P3 顺带交付】** 复用现有 `intake-gateway`，10 行配置搞定 |
| **TOP 5** | **个人微信 / 微信公众号客服消息** | ⭐⭐⭐⭐⭐ 难（限制多） | 公众号需认证服务号才有完整客服接口且有 48h 交互限制；个人微信号非官方 Hook 极易封号 | 资质与合规门槛高 | **【暂不直接做】** 建议通过「企微微信插件」或「iOS 快捷指令」平替 |

> **结论建议**：**P3** 先上线「Web 极简速记入口 + iOS 快捷指令/浏览器书签配置生成器」；**P4** 优先接入 **飞书机器人（TOP 1）** 和 **企业微信机器人（TOP 3）** 两个 IM 通道（Telegram/Discord 为 TOP 2 备选，按日常使用习惯决定是否替代企微）。

---

## 三、 P1 ～ P7 总体升级与施工计划

整个 V2.0 拆解为若干独立可验证的阶段，每个阶段聚焦一个清晰闭环。**执行顺序**：P1 → P2 → P1.5 → P3 → P6a → P4 → P5 → P6b → P7。编号只表示阶段身份，不表示顺序；P1、P2 已完成的是契约与纯函数，服务端落地由 P1.5 承担。

```mermaid
flowchart LR
    P1["P1: Harness 契约与纯函数<br/>(已完成)"] --> P2["P2: 去Obsidian化<br/>知识库种子 + MD导入导出<br/>(已完成)"]
    P2 --> P15["P1.5: Harness 内核服务端落地<br/>agent_jobs 队列 + workers/agent<br/>Mandate 入库强制"]
    P15 --> P3["P3: Web极简速记入口<br/>采集 → 出稿待审闭环"]
    P3 --> P6a["P6a: Decision Memory 回灌最小版"]
    P6a --> P4["P4: IM通道接入<br/>飞书 + 企微"]
    P4 --> P5["P5: Web视频工坊<br/>workers/video 封装 video-factory"]
    P5 --> P6b["P6b: 多平台发布排期与复盘"]
    P6b --> P7["P7: sense-site读者站<br/>快照发布 + 部署封装"]
```

---

### 🔹 P1：Agent Harness 自循环内核 + 「国内大模型 API & 本地 CLI」双模中间层（方向 A 基座）
- **核心目标**：建立统一的 Agent 编排与模型调用底座，支持直连国内模型厂家 API（Qwen / Kimi / DeepSeek / GLM）和调用本地 Agent CLI（Pi / OpenCode / Codex / agy），并实现「指令数据分离 + 生成↔只读评估自循环」。
- **具体交付内容**：
  1. **契约与配置层（`src/contracts/agent-harness.ts`）**：定义统一的模型提供商枚举（`qwen`、`kimi`、`deepseek`、`zhipu`、`openai-compatible`）与本地 CLI 驱动枚举（`pi-cli`、`opencode-cli`、`codex-cli`、`agy-cli`）。
  2. **Harness 核心引擎（`src/services/agent-harness-service.ts`）**：
     - **Context Pack 安全组装器**：强制将外部信源正文包裹在 `<untrusted_source_data>` 沙箱标签内，注入租户 `DecisionMemory`（决定记忆）与知识库规则，防止提示词注入。
     - **Generator ↔ Evaluator 循环控制器**：支持配置 `maxEvaluationRounds`（默认 3 轮），由只读 Evaluator 按事实/风格/禁忌清单打分，通过后才流转为 `pending_review`。
     - **Mandate 人工门禁检查器**：明确区分 AI 可自动推进的操作与必须人工签名的操作（发布、高额视频生成、权限变更）。
  3. **服务端与本地 CLI 适配桥接器**：升级 `content-draft` 与本地 CLI 调用规格，支持在控制台「系统设置」可视化配置/切换国内 API 与本地 CLI 通道。
  4. **范围说明**：本阶段交付的是契约与纯函数（可单元测试的逻辑），不含服务端队列与常驻进程；服务端落地见 P1.5。CLI 驱动先只验证 Codex，prompt 走 stdin 而非 argv；其余 CLI 仅在注册表中标注「未验证」。
- **自测验收标准**：编写 `agent-harness.test.ts`，覆盖指令数据隔离防注入、3 轮评估熔断、国内模型路由构造、CLI 调用规格生成与 Mandate 门禁拦截测试。
- **状态**：已完成（契约与纯函数）。

---

### 🔹 P2：去 Obsidian 化 + 项目内建知识库（`knowledge-base/`）与 Markdown 导入导出
- **核心目标**：剥离 Obsidian 本地耦合，建立云端与项目目录双支持的受控知识库，支持 Markdown 标准导入导出。
- **具体交付内容**：
  1. **默认种子目录（`knowledge-base/`）**：仓库根目录 `knowledge-base/` 作为默认种子（含 `brand-voice/` 品牌调性、`sops/` 创作规范，后续可增 `domain-facts/`），导入到 `knowledge_entries` 表后才参与运行；运行时唯一权威是 Postgres，目录内文件不被运行时直接读取。
  2. **知识库管理与 Markdown 导入导出服务（`src/services/knowledge-base-service.ts`）**：
     - 支持将任意 `.md` 文件解析 Frontmatter 与正文后直接导入为平台「信源 / 知识条目 / 稿件草稿」；
     - 支持将平台稿件、选题 Brief 与复盘记录导出为标准无损 Markdown 包；
     - 将知识库条目自动关联到 P1 的 Context Pack 中，供 Agent 创作与审查时按需检索引用。
- **自测验收标准**：编写 `knowledge-base.test.ts`，验证 Markdown 导入解析、XSS/恶意脚本清洗、知识条目向 Context Pack 注入及导出一致性。
- **状态**：已完成（解析与导入导出纯函数）；`knowledge_entries` 表与种子导入随 P1.5 落地。

---

### 🔹 P1.5：Harness 内核服务端落地（`workers/agent` 实装，P2 之后、P3 之前）
- **状态**：代码完成、本地验证通过（PGlite 与假客户端），线上未部署。演示：`npm --prefix sense-console run demo:harness`；worker 启动：`npm run worker:agent`。事实基准见 `sense-console/docs/agent-harness.md` 与 `sense-console/workers/agent/README.md`。
- **核心目标**：把 P1/P2 的契约与纯函数变成可独立运行的 Node 出站 worker（`sense-console/workers/agent/`），由 worker 反向认领任务表队列，浏览器关闭后后台任务仍可推进到 `pending_review`。
- **已实现交付内容**：
  1. **任务表队列**：`agent_jobs` + `agent_job_steps`，以 `FOR UPDATE SKIP LOCKED` 的认领 RPC 实现（不使用 pgmq）；含幂等键、最大尝试次数、超时、取消与成本字段。（不含 `cli_session_id`，见「目标设计，未实现」。）
  2. **worker（`npm run worker:agent`）**：纯出站进程，通过认领 RPC 拉取任务，不托管前端，不需要公网 IP。
  3. **新表与 RLS**：`decision_memories`、`knowledge_entries`（带 `trust_level`，未审核的导入知识不进入 system prompt）、`approval_requests` 的 migration + RLS，均绑定 `organization_id`。
  4. **Mandate 门禁下沉到数据库**：发布、高额视频生成、权限变更等由触发器 / RPC 强制校验 `approval_requests`；浏览器端检查只是 UX。
  5. **评估器两层**：确定性预检（长度、引用、禁忌词、结构）+ 独立模型的 LLM 评估器（输出结构化 JSON 清单）；硬上限 `MAX_ROUNDS = 3`。
  6. **`content-draft` Edge Function 改为入队**：函数只负责校验与写入 `agent_jobs`，循环在 worker 中执行。入队模式尚未在真实 Edge 环境实测。
  7. **数据库测试**：用进程内 PGlite 跑全量迁移 + RLS 测试。
  8. **本地桥说明**：Vite dev server 中的 `/__sense_bridge` 仅为开发期配置与连通性自测工具，带 loopback / Origin / Token 校验，生产不存在；正式的本地算力路径是 worker 反向认领。
  9. **CLI 驱动**：当前以 Codex 为目标，但未真实调用；prompt 走 stdin；worker 读自身环境变量中的模型凭证。个人订阅的 CLI 只适用于自带节点继承宿主机登录态，不用于给多租户托管服务供能。
- **目标设计，未实现**：`sense-runner` 三形态、工作区物化协议、`cli_session_id` 续接、租户 API Key 按次注入，见第五节。
- **自测验收标准**：PGlite 迁移 + RLS 测试（跨组织隔离、Mandate 绕过尝试被拒、SKIP LOCKED 并发认领不重复）；worker 单元测试；**行为级验收**：入队一个 content-draft 任务 → worker 认领 → 完成 ≤3 轮生成与评估 → 写入带评估记录与成本的 `pending_review` 提案（本地假模型下已通过）。

---

### 🔹 P3：Web 极简速记入口（Quick Capture）+ 一键「采集 ➔ 自动出稿待审」闭环（方向 B 第一步）
- **状态**：代码完成、本地验证通过，线上未部署。含 `quick_capture` RPC、顶栏速记与 Cmd/Ctrl+K、`/capture` 页、任务中心接真实数据、worker 抓取正文（SSRF 防护）。演示：`npm --prefix sense-console run demo:capture`；详见 `sense-console/docs/quick-capture.md`。
- **核心目标**：不用填写繁琐表单，在网页任意位置（顶部速记栏 / 快捷键 / 独立极简收集页）输入一条链接或一句话想法，即可选择「仅收藏进选题库」或「立即自动立项并生成母稿+平台稿到待审核」。
- **具体交付内容**：
  1. **全局极简速记组件（`QuickCaptureModal` / 顶栏极简输入框）**：支持粘贴 URL + 一句话角度 + 意图切换（`capture_only` 仅收录 vs `auto_draft` 自动出稿到待审）。
  2. **自动流水线编排**：当意图为 `auto_draft` 时，原子化完成「保存信源 → 创建选题 → 立项 Content Project → 写入 `agent_jobs` 队列由 Harness 生成母稿与指定平台稿 → 进入审核中心待审」。
  3. **以“待我处理”为中心的任务与审核提醒**：在工作台与任务中心优先高亮「等我审核的草案 / 等我拍板的选题 / 失败阻塞项」。
  4. **输入意图约定（Web 与 IM 通用）**：
     - 裸链接或 `capture_only`（“收藏一下”）：仅进入选题库待评估区，做自动摘要、分类与建议角度，暂不触发高成本出稿；
     - `auto_draft`（“做这个 / 写成 X 和公众号 / 从这个角度写”）：自动立项并入队制作到 `pending_review`；
     - `补充到 #任务号` / `改一下 #任务号`：附加到已有任务并生成新版本提案，不创建重复项目；
     - 审核指令（“通过” / “通过并发布”）必须严格绑定具体 `document_id + revision + channel_id`（对应数据库 `approval_requests`），没有明确版本上下文时绝不猜测，改稿后旧批准自动失效。
- **高频输入场景覆盖（P3 首版支持文字与 URL，P4 扩展媒体与附件）**：
  | 场景 | 用户输入 | 系统处理边界 |
  | :--- | :--- | :--- |
  | 电脑/手机浏览 X 或网页 | 粘贴链接 + 一句角度（如“从企业应用角度写”） | 保留原始输入、URL、角度与时间；外网抓取限私网防 SSRF、大小与超时 |
  | 公众号/长文链接 | 复制文章链接或摘录正文 | 先收录原记录；不可直接抓取时提示补充摘录，不伪称已读取原文 |
  | 短视频分享文案/口令 | 粘贴分享文案或短链 | 保存原文与解析结果；仅在合法获取字幕或用户提供文件时做正文分析 |
  | 突发灵感 | 一句话主题（后续可补语音） | 保存原始意图，结合知识库与公开证据生成候选或草案 |
  | 截图/文件（随 P4 扩展） | 主动发送图片/文件附件 | 保存到私有对象存储；OCR/转写注明可能误差，不将截图直接当完整原文 |
  | 浏览器插件/iOS 快捷指令 | 主动触发发送当前 URL、标题、选中文字 | 复用 `intake-gateway` Bearer API；只采集用户明确选中的内容，不持续监控剪贴板 |
  | 定期发现选题 | 指定 RSS、站点或搜索主题 | 定时采集、去重与候选推荐（每批最多 3 个），由人选定后才立项 |
- **自测验收标准**：单元测试 + 组件测试验证极简输入解析、意图分流、防重复提交与状态流转。
- **行为级验收**：一条真实链接进入 → 原子建立信源/选题/项目并入队 → worker 产出带评估记录与成本的 `pending_review` 提案。

---

### 🔹 P4：最简 IM 通道接入（飞书机器人 TOP 1 + 企业微信机器人 TOP 3）（方向 B 第二步）
- **状态**：代码完成（飞书与企微 `im-webhook`、回执、待审通知卡片），本地验证通过，线上未部署、未真实联调。**IM 内一键批准未做**：卡片按钮仅为跳转后台的链接，因 IM 用户与后台账号的身份绑定尚未设计。部分协议字段未对照官方文档，Deno 打包未验证。详见 `sense-console/docs/im-channels.md`。下文中的「一键批准」「按钮回传」「账号身份绑定」均为原设计目标，非现状。
- **核心目标**：打通飞书自建机器人与企业微信机器人，实现手机随手转发链接/文字入库，并在 IM 内收到「待审核交互卡片」；关闭浏览器或个人电脑后，云端队列任务照常执行并回传回执。
- **具体交付内容**：
  1. **多渠道 Webhook 统一适配器（`adapters/im/` & `intake-gateway` 扩展）**：
     - **飞书适配器（Feishu Adapter）**：支持飞书事件订阅验签、文本/富文本链接提取、以及飞书交互式消息卡片（含「查看预览」「通过暂存」「退回重改」「通过并发布」按钮回传，长文附带控制台详情深链接）。
     - **企业微信适配器（WeCom Adapter）**：支持企微智能机器人 Webhook 消息接收与 Markdown 审核通知卡片推送。
     - **安全与防重约定**：外部 IM 消息一律先经 `intake-gateway` 验签、组织身份绑定与幂等去重；原文作为 `<untrusted_source_data>` 隔离处理，转发文章内的任何文本均不能越权触发审核或发布；业务处理失败与 IM 通知回执失败分开重试。
  2. **控制台「外部接入」页面升级**：内置飞书、企微、iOS 快捷指令的一键配置向导、账号身份绑定与连通性自检按钮。
- **自测验收标准**：编写 `im-adapters.test.ts`，用真实飞书/企微 Payload 样本测试签名校验、消息解析、幂等防重与卡片构建。
- **行为级验收**：在飞书发送一条链接 → 收到回执 → 稍后收到待审卡片 → 点击「退回」带理由后状态与 Decision Memory 候选正确落库；旧版本稿件上的历史卡片按钮在改稿后自动失效拒绝审批。

---

### 🔹 P5：Web 视频工坊（Video Studio）实装落地（方向 C 核心模块）
- **状态**：代码完成、本地验证通过，线上未部署。含 `video_plans` / `video_shots`、分镜工作台、`video_storyboard` 任务、Python 视频 worker（`sense-console/workers/video/`）、付费渲染的数据库级批准。演示：`demo:video`。**未做**：关键帧上传/生成界面、云端 TTS 引擎、图形化多轨时间线、拖拽排序；真实视频引擎与计费未验证。
- **核心目标**：将 `sense-console` 中的视频模块从演示页升级为真正可交互的 **Web 分镜工作台**，并与 `video-factory` 执行引擎打通（基于已验证的 Demo 001 本地 Ken Burns 运镜 + Edge-TTS 音画同步 + BGM Ducking 混音，以及 Demo 002 万相 2.7 AI 视频 + 多轨 SFX 拟音链路）。
- **行业标杆对齐与冷热混合护城河**：
  - 对齐 **LiblibAI 角色一致性资产库（Character Bank）**、**小云雀一键拆解分镜与单镜重抽**、**海螺AI 电影级运镜语言**；
  - 核心护城河：**冷热混合渲染调度**（概念架构图/静态插画走本地 Ken Burns 运镜，¥0 成本；高动态动作按需走云端视频模型；相对商业生成平台的成本优势为未验证估算，无实测依据，且全资产私有可控）。
- **具体交付内容**：
  1. **视频分镜数据契约与状态服务（`src/contracts/video-studio.ts` & `src/services/video-studio-service.ts`）**：标准化 `VideoPlan` 与 `VideoShot`（景别、运镜方式：`local_ken_burns` vs 云端视频生成模型（如万相，具体型号以控制台配置为准）、旁白台词、精确毫秒时长、SFX 音效描述、关键帧与视频资产 URI、单镜渲染状态）。
  2. **可视化分镜画布升级（`storyboards-page.tsx` & 分镜卡片组件）**：
     - **大纲智能拆解**：输入故事/解说大纲，通过服务端入队 `agent_jobs` 调用控制台配置的国内大模型（如 Qwen / Kimi）一键生成结构化分镜卡片流（禁止浏览器直连模型或持有 Key）；
     - **角色库与单镜精细控制**：关联 `assets` 中的角色参考图保证跨镜一致性；在线修改旁白台词、切换配音角色音色、试听单句 TTS、一键触发「云端视频模型单镜重抽」或「本地运镜毫秒级合成」（单镜重抽不影响全片其余镜头）；
     - **多轨时间线与成片预览**：展示旁白轨 + SFX 拟音轨 + BGM Ducking 混音状态，内嵌播放器预览成片并展示单次成本账本。
  3. **`sense-console/workers/video/`（Python）与冷热存储协同**：
     - 封装现有 `sense-console/video-factory/`，通过 `agent_jobs` 同一任务队列消费 Web 下发的单镜重抽与全片合成指令；
     - **冷热分层存储**：Supabase Postgres 保存 `assets` 元数据账本（`storage_uri`、`mime`、`hash`、关联 `shot_id`）；本地热工作区（Hot Cache）负责 0 延迟 FFmpeg 多轨混音合成与临时切片；云端对象存储（Cold Lake：OSS/R2/Supabase Storage）持久归档关键参考图、单镜视频与成片，Web 端通过短期签名 URL 在线预览；
     - 高额视频生成动作受 Mandate 数据库门禁（`approval_requests`）约束，超出预算自动挂起待批。
- **自测验收标准**：编写 `video-studio.test.ts`，验证大模型分镜 JSON Schema 校验、Audio-First 时长对齐计算、单镜头状态机局部更新与成本估算。
- **行为级验收**：一份大纲 → 队列生成分镜卡片 → 单镜试听与重抽 → 全片合成上传对象存储 → 资产库出现带成本账本的成片。

---

### 🔹 P6a：「决定记忆（Decision Memory）」回灌最小版（从原 P6 拆出，P3 之后提前）
- **状态**：代码完成、本地验证通过，线上未部署。审核退回/通过与复盘时可记入决定记忆；已有决定记忆页与知识库页。
- **核心目标**：尽早形成「退回理由 / 复盘结论 → 下一轮出稿自动遵守」的最小回路，避免早期人工纠正白白丢失。
- **具体交付内容**：审核中心「退回」填写理由、或复盘页填写「下次改进变量」时，可一键勾选「记入长期创作偏好」，写入 `decision_memories`；Context Pack 组装时按租户检索并注入（带条数与长度上限）。
- **自测验收标准**：记忆写入 RLS 隔离测试；注入上限与排序测试。**行为级验收**：退回一份稿件并记入偏好 → 下一份同类稿件的 Context Pack 含该偏好，评估清单据此检查。

---

### 🔹 P6b：图文+视频统一多平台发布排期与复盘
- **状态**：代码完成、本地验证通过，线上未部署。发布到读者站需数据库级批准（请求 → 批准 → 发布三步）；有发布排期视图；稿件版本变更使旧批准与旧排期失效。排期只是计划记录，不自动发布。
- **核心目标**：让图文稿件与 P5 产出的视频成片共用同一套多平台发布与复盘闭环。
- **具体交付内容**：视频资产一键转发布计划，可关联视频号、抖音、小红书、B站、YouTube、X，附自动生成的平台标题、话题标签与封面图；发布动作受 Mandate 数据库门禁约束，仍由人类批准具体版本和账号。
- **自测验收标准**：图文/视频混合发布排期校验、版本变更自动失效旧排期。**行为级验收**：审核通过的成片 → 生成各平台发布计划 → 人工批准 → 人工发布记录与指标快照回写。

---

### 🔹 P7：独立读者内容站 `sense-site` 建设与部署封装（方向 D = 独立读者站 `sense-site`）
- **状态**：`sense-site` 读者站首版代码完成（公开/注册可见性、专题、收藏、资源下载、演示模式 `npm --prefix sense-site run dev:demo`），本地验证通过，线上未部署，详见 `sense-site/README.md`。部署封装见 `sense-console/deploy/`（由另一工作流维护）。
- **核心目标**：落地独立 `sense-site`（获批的同级读者站工程，详见 [sense-site 建设计划](sense-site-plan.md)）面向外部读者展示已批准内容，并完成服务端部署封装。当前不做多租户自助入驻与计费。
- **具体交付内容**：
  1. **`sense-site` 独立前端与快照发布事务**：实现后台一键将已审核图文/视频发布到 `site_entries` 快照表，读者站支持公开阅读、注册读者阅读、专题浏览与资源鉴权下载。
  2. **部署封装**：服务端一键部署脚本（Web + worker 容器化）；组织级 provider 配置（服务端加密存储）尚未建设，目前 worker 读自身环境变量。计费与租户自助入驻推后到单条真实链路跑通之后再评估。
- **自测验收标准**：跨工程独立 `typecheck / lint / test / build` + 匿名/注册读者权限隔离测试（数据库 RLS 测试）。
- **行为级验收**：人工批准版本 → 站点发布快照 → 无痕游客可读 → 下线后不可读。

---

## 四、 自动化验证与自测机制（Verification Harness）

为确保**「做完自己测试，通过后才往下推进」**，采用**五道门禁**，每个阶段结束前必须执行并输出绿灯报告：

```bash
# Gate 1: TypeScript 严格类型检查
npm --prefix sense-console run typecheck

# Gate 2: ESLint 静态规范与安全边界检查
npm --prefix sense-console run lint

# Gate 3: Vitest 全量单元与集成测试（每个阶段必须新增对应 .test.ts）
npm --prefix sense-console run test

# Gate 4: 生产包编译构建验证
npm --prefix sense-console run build
```

**Gate 5：数据库迁移 + RLS 测试（涉及数据库时必做）**：使用进程内 PGlite 跑全量 `sense-console/supabase/migrations/*.sql`，并执行 RLS 测试（跨组织隔离、角色能力、Mandate 绕过尝试被拒、并发认领）。测试脚本随阶段提交，同时保留 `sense-console/supabase/tests/*.sql` 事务回滚验收脚本。

**行为级端到端验收**：每个阶段除自动化门禁外，必须有一条可演示的真实行为链路（各阶段「行为级验收」条目），例如 P3：一条真实链接进入 → 产出带评估记录与成本的 `pending_review` 提案。门禁全绿但行为链路不通，不算阶段完成。

此外：
- 本节门禁在本地与 PGlite 上执行；真实 Supabase 环境未覆盖。
- 涉及页面交互变更时，同步验证路由渲染与组件可访问性；
- 新增 worker 工程（`workers/agent/`、`workers/video/`）须有各自的类型检查与测试命令，并纳入同一交付报告。

---

## 五、 目标设计，未实现

以下内容曾在本计划及 V2 统一架构文档中被写成已具备的能力，但**代码中不存在**。它们是目标设计，不是现状；任何阶段验收均不依赖它们。

| 项 | 目标设计 | 与现状的差异 |
| :--- | :--- | :--- |
| a. `sense-runner` 三形态 | 同一程序支持开发态、`npm run start` 单进程托管前端并跑循环、`npm run runner` 个人电脑挂载 | 不存在 `sense-runner`、`npm run start` 托管前端、`npm run runner`。实际只有 `npm run worker:agent`，worker 是纯出站进程，不托管前端 |
| b. 工作区物化协议 | 认领后在 `/workspaces/job_<id>/` 生成 `TASK.md`、`MEMORY.md`、`inputs/`、`outputs/draft.md`，CLI 在其中执行并归档 | 实际 CLI 驱动使用空临时目录 + 只读沙箱，prompt 走 stdin。只读沙箱下无法写 `outputs/`；若要做，需重新设计安全模型 |
| c. `cli_session_id` 与 `--resume` | 记录 CLI 会话 ID，评估打回或追问时续接原会话 | 不存在。现有 `resume_agent_job` 指任务重新排队并增加轮次，是另一回事 |
| d. 每次任务注入租户 API Key | 租户 provider 密钥加密存于组织级配置表，按次注入子进程 | 组织级 provider 配置表未建，worker 读自身环境变量。BYOK 与加密存储、按组织签发的受限 worker 凭证、计费与租户自助入驻均未做 |

## 六、 已知断层与未验证项

1. 线上 migration（20261115 及之后）与知识库种子尚未应用。
2. 真实 Supabase 的 PostgREST / Storage / Auth 行为未验证，目前只在 PGlite 与假客户端上验证。
3. Edge Function 的入队模式与 `im-webhook` 的 Deno 打包未实测。
4. Codex 未真实调用；pi / opencode / agy 的无交互参数未验证。
5. worker 使用 `service_role`（数据库最高权限），在个人电脑节点上有凭证泄露风险；按组织签发的受限凭证未实现。
6. IM 用户与后台账号的身份绑定未设计，因此 IM 内不能直接批准。
7. 飞书 / 企微部分协议字段未对照官方文档、未联调。
8. 视频真实引擎（TTS、云端视频模型、全分辨率合成）与真实计费未验证。
9. Dot 手机端接入一直未验收。
10. 各页面未在真实浏览器里点测过，只有编译加载与组件测试。

## 七、 待负责人决定

以下仅列问题与总架构师建议，不替负责人决定。

1. **物化协议与会话续接是否要做？** 建议暂不做（需重新设计只读沙箱下的安全模型，且当前链路不依赖）。
2. **预算口径**：旧文档「不设硬预算、只记 token」与 V2 已实现的预算熔断不一致。建议以 V2 为准。
3. **已删除的 `frame-work.md` 中的 Supabase 安全验收清单**是否并入 `sense-console/docs/supabase-data-model.md`？建议并入。
