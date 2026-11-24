# 前端约定

> 由旧 `frontend-conventions.md` 和 `shadcn-foundation.md` 合并而来。适用于 sense-console 和 sense-site。

## 1. 技术基座

React 19、TypeScript strict、Vite、React Router 7、Tailwind CSS 4、TanStack Query、shadcn/ui（Base UI，Nova 预设 `b0`，Neutral 基础色，Inter 字体，Lucide 图标，圆角 `0.625rem`）。Console 的骨架基于 `dashboard-01`，登录页基于 `login-04`。

## 2. 规则

1. 只用一套组件库。基础控件全部来自 `src/components/ui/`（shadcn 源码分发），不要重复造 Button、Card、Sheet、Table。
2. 颜色只用语义变量（background、foreground、card、muted、primary、accent、destructive、border、ring），页面里不散写品牌色或状态色。
3. 导航最多两级。
4. 页面保持精简；数据访问放在 service 层。0.5 起按模块放在 `src/modules/<域>/services`。
5. **同一种交互全项目只有一个实现**，已有共享组件就必须复用。清单：
   - 分类层级下拉一律使用 `CategorySelect`（`components/source-categories/category-select.tsx`）。直接传扁平的分类数组即可，由组件自己建树和缩进。唯一的例外是「选择上级分类」，因为只能选顶级分类，用 `NativeSelect` 就够了。
6. 更新 shadcn 组件前先运行 `npx shadcn@latest info`，逐个组件更新；`--overwrite` 会覆盖本地改动，执行前先看差异。

## 3. 已知的坑：Base UI `Select` 必须传 `items`

`<SelectValue>` 默认只把 value 原样显示出来。只要选项的显示文本和 value 不是同一个字符串，就必须给 `<Select>` 传 `items`（`value → label` 的映射或 `{value, label}[]`），否则选中后会显示 `"2"` 而不是「行业情报」。`items` 只影响触发器上显示的文本，`<SelectItem>` 仍然要照常写。

## 4. 内容工作流与详情页设计规范

### 4.1 后端状态到前端工作流的单一映射

- 禁止把 `work_items.status`、`agent_jobs.status`、`content_documents.status` 三套技术状态以同名「待审核」直接散落到页面各处，让用户自己猜测先后顺序。
- 详情页顶部必须提供单一的 **1–2–3–4 线性进度条**（`1 准备与出稿 → 2 审阅与定稿 → 3 发布与分发 → 4 归档完成`），并用通俗中文提示当前卡点与唯一的主行动按钮（CTA）。
- 「审核中心」必须把两类需要人审阅的对象聚合成同一待办流：**AI 草稿待审阅**（`work_items.status === 'review'` 且仍有未定稿稿件）与 **已提交待审核**（`content_documents.status === 'in_review'`）。

### 4.2 单人效率与数据库门禁并存

- 不得削弱或绕过数据库触发器（`guard_cloud_content`）与 Mandate（`approval_requests` / `decide_approval_request`）；每一步操作仍以当前登录用户的 JWT 落库并留审计记录。
- 当当前登录成员同时持有连续步骤权限时（如兼有 `content.manage` 与 `content.review`，或兼有 `content.manage` 与 `content.publish`），前端应提供一键串联操作（如「确认并定稿」顺序完成 `in_review → approved`、「一键批准并发布」顺序完成 `request → approve → publish`），同时保留分步按钮以兼容多人审校分工。

### 4.3 成品 Markdown 阅读与核实体验

- 稿件成品浏览与审核优先呈现排版后的 Markdown（统一通过 `renderSafeMarkdown` + `.console-prose` 渲染，禁止裸 HTML），并支持「阅读预览 / 编辑原文 / 双栏对照」与全屏沉浸阅读。
- 当稿件处于待审状态（含 AI 刚写入 `pending_review` 对应的版本）或已定稿状态时，默认打开「阅读预览」，并在文首展示字数、预计阅读时长与 `[待核实]` 标记数量。

### 4.4 三层注意力分配与信息布局

1. **第 1 层（主栏焦点）**：顶部面包屑 + 简洁页头 + `1-2-3-4` 步骤进度与行动条 + 稿件阅读/编辑主画布 + 仅在定稿后渐进展开的发布分发区。
2. **第 2 层（右侧上下文侧栏，`360px`）**：用 `Tabs` 收纳低频参考与辅助工具（「AI 助手」「Brief 与素材」「版本记录」），避免拉长主画布、冲淡主操作。
3. **第 3 层（收纳区与护栏）**：修改 Brief、填写退回原因与长期创作偏好、视频/文本交接包导出、放弃事项等收敛到 `Dialog` / `Collapsible` / `DropdownMenu`；当稿件尚未定稿却将看板状态改为「完成」时，通过 `AlertDialog` 显式提醒并给出「先去定稿」入口。

### 4.5 shadcn/ui（Base UI · Nova `b0`）对齐清单

- 表单字段统一使用 `@/components/ui/field`（`Field` / `FieldGroup` / `FieldLabel`），主工作区禁止裸用原生 `<details>`/`<summary>`（改用 `Collapsible`、`Accordion`、`Dialog` 或 `Tabs`）。
- 下拉切换统一用 `Select`（必传 `items`）或 `DropdownMenu`；空态用 `Empty`，加载态用 `Spinner` / `Skeleton`，卡片操作与页脚充分利用 `CardAction` / `CardFooter`，颜色仅使用 `index.css` 语义变量。

## 5. AI Chat 与 AI Elements（Base UI）组件规范

> 适用于 `sense-console/src/modules/chat`（`/chat` 与 `/h5/chat`）以及事项详情页嵌入的 AI 助手区。详见模块设计 [../modules/chat.md](../modules/chat.md)。

### 5.1 基座现状（事实）

- `sense-console` 基于 `shadcn@4.19.0` + `@shadcn/react@0.3.0` + `@base-ui/react`（`components.json` 中 `style: "base-nova"`）。
- `src/components/ui/` 中**已安装**可用于 Chat 的官方组件原语：
  - 消息容器与自动吸底滚动：`message.tsx`、`message-scroller.tsx`
  - 气泡与附件卡片：`bubble.tsx`、`attachment.tsx`、`marker.tsx`
  - 结构化反问 / 多项选择：`questionnaire.tsx`（直接适配 Agent 提问或人工确认交互）
  - 基础容器与输入组合：`input-group.tsx`、`command.tsx`、`combobox.tsx`、`collapsible.tsx`、`sheet.tsx`、`drawer.tsx`、`scroll-area.tsx`

### 5.2 避坑清单（强制遵守）

1. **禁止混入第二套底层原语库（Radix vs Base UI）**：Vercel AI Elements 生态已并入 shadcn 体系，但部分社区/旧版配方依赖 `@radix-ui/*` 与 `asChild` 属性。本项目锁定 `@base-ui/react`，引入或移植 `Model Selector`、`Prompt Input`、`Reasoning`、`Plan`、`Task`、`Stack Trace` 等 AI Elements 组件时，**一律改写为 Base UI `render={...}` 与项目现有 `src/components/ui/` 原语**，严禁引入 `@radix-ui/*`。
2. **Base UI `Select` 必传 `items`**：Model / Node 选择若使用 `Select`，遵循第 3 节要求传 `items`；多级模型搜索与分组优先基于已有的 `Combobox` / `Command` / `DropdownMenu` 组合。
3. **Markdown 渲染必须走安全消毒**：Chat 流式正文、思考摘要和代码块严禁直接拼接未消毒 HTML，统一复用 `renderSafeMarkdown` + `.console-prose`（或受控安全渲染器）。
4. **语义 Token 约束**：不给不同模型厂家（Qwen / DeepSeek / Codex 等）硬编码品牌色或 raw 颜色；状态统一使用 `primary` / `muted` / `destructive` / `border` 等语义变量。
5. **桌面与 H5 共用一套实现**：`/chat` 与 `/h5/chat` 共用核心组件，窄屏下左侧历史会话栏自动收敛为 `Sheet` / `Drawer`，不单独维护第二套移动 Chat 页面代码。
6. **流式读取用 `fetch`，不用 `EventSource`**：节点 HTTP 入口是 `POST` 且必须带 `Authorization: Bearer <Supabase JWT>`，原生 `EventSource` 只支持 GET、不能设请求头。统一封装一个 `fetch` + `ReadableStream` 的 SSE 解析 Hook（放在 `modules/chat`，忽略 `: ping` 注释行），各组件只消费解析后的 `ChatStreamEvent`。
7. **断开 ≠ 停止**：组件卸载、切页、H5 切后台只断开读取流，**不要**顺手调 `cancel_agent_job`；只有用户点「停止」才调用（见 [../modules/chat.md](../modules/chat.md) 2.3）。重新进入会话时，对 `running` 的回合显示「生成中」占位并等待落库结果。

### 5.3 按需引入三阶段清单

遵循「场景需要时再引入，不一开始全量堆砌」的原则：

| 阶段 | 引入组件 | 承担职责 | 对应数据来源 |
| --- | --- | --- | --- |
| **Phase 1（MVP 必选）** | 会话侧栏、`MessageScroller`、`Message` / `Bubble`、`Prompt Input`、`Model Selector` | 持久会话切换、流式消息滚动、多行输入/附件/Slash 命令/`@` 引用/停止按钮、在线节点 API/CLI 与思考模式选择 | `chat_sessions`、`chat_messages`、`runner_nodes.capabilities` |
| **Phase 2（过程透明化）** | `Reasoning`、`Plan`、`Task` / `Tool`、`Questionnaire` | 流式折叠思考过程、多步执行计划、单步工具调用与后台任务进度、Agent 反问与高风险权限/Mandate 确认卡 | `chat_messages.parts`、SSE 事件流、`approval_requests` |
| **Phase 3（排错与审计）** | `Stack Trace`、`Artifact` 预览链接 | 仅在工具报错、CLI 非零退出或 Harness 熔断时折叠展开调用栈与错误上下文；关联跳转已生成稿件/分镜 | `chat_messages.parts`（`error` / `stack_trace`）、`agent_job_steps` |

