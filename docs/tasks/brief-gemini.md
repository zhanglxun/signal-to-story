# 任务简报 · Gemini 4 · 第一波：Pi spike + Chat UI Phase 1

> 2026-11-24 · 分工与合并规则见 [parallel-plan.md](parallel-plan.md)。你的分支 `feat/chat-ui`，worktree `../sts-chat-ui`。合并、验收由 Claude 负责。

## 启动提示词（用户整段发给 Gemini）

```text
你在 signal-to-story 仓库的 worktree ../sts-chat-ui（分支 feat/chat-ui，从 0.5.0 切出）中工作。
先完整阅读：AGENTS.md、docs/architecture.md、docs/conventions/frontend.md（特别是第 5 节）、
docs/modules/chat.md（全文，第 2.3 表与 2.4「HTTP 接口约定」是冻结约定，第 5 节是已确认决定）、
docs/tasks/parallel-plan.md、docs/tasks/brief-gemini.md（本简报）。

按 brief-gemini.md 的顺序执行：任务 A（Pi 厂商兼容 spike，只交结论文档）→ 任务 B（Chat UI Phase 1，假传输）。

硬性规则：
- 只改 parallel-plan.md 第 3 节分配给你的路径：sense-console/src/modules/chat/**、App.tsx 中新增一条 /chat-next 路由、
  以及 docs/tasks/pi-spike-result.md。不碰 sense-console/src/pages/chat-assistant-page.tsx、src/harness、src/contracts、
  workers/、supabase/、根目录 package.json。
- 不新增第二套组件库，不引入任何 @radix-ui/*；复用 sense-console/src/components/ui 已有组件。
- 浏览器代码不得出现任何密钥；spike 用的模型 Key 只从环境变量读，绝不写进文件或提交。
- 只在 feat/chat-ui 上提交；不 push、不 merge、不 rebase 到其他分支。
- 冻结约定（chat.md 2.3 / 2.4）有疑问时不要自行改协议，在交付报告「偏差与理由」里写明。

完成后按 parallel-plan.md 第 5 节格式输出交付报告。
```

## 任务 A：Pi 厂商兼容 spike（半天，只交结论）

- **目的**：为 Claude 的 R3.0 选定首批可用厂商，并核实 `@mariozechner/pi-ai` / `@mariozechner/pi-agent-core` 的真实 API（chat.md 4.2 中的 API 名称是未经核实的）。
- **位置**：在**仓库外**新建临时目录（如 `../sts-pi-spike/`，自带 `package.json`），不进任何分支。用户提供的 Key 只通过环境变量传入。
- **逐个厂商验证**（Qwen DashScope 兼容模式、DeepSeek（含 Reasoner）、Kimi、GLM，用户手里有哪个测哪个）：
  1. 流式文本增量是否正常；
  2. 思考内容（如 `reasoning_content`）能否作为独立的 thinking 事件拿到；
  3. 定义一个简单工具（如 `get_time`），能否完成「调用 → 回填结果 → 继续回答」的多步循环；
  4. `AbortSignal` 中止是否立即生效；
  5. 返回的 usage（输入 / 输出 token）是否可得。
- **交付**：`docs/tasks/pi-spike-result.md`（提交在 `feat/chat-ui`）：所用包与**精确版本号**、实际用到的 API（函数 / 类型 / 事件名，附 20 行以内的最小代码片段）、每个厂商 × 5 项的结果表、建议首批进目录的厂商与已知坑。不写 Key、不写个人路径、不写账号信息。

## 任务 B：Chat UI Phase 1（假传输，不依赖后端）

目标：在 `sense-console/src/modules/chat/` 建出新 Chat 界面，通过 `/chat-next`（桌面）与 `/chat-next?h5=1` 或等价方式（窄屏）可访问。后端未就绪期间用**纯前端的假传输**驱动；第二波只需把传输换成真实 HTTP。

### 结构（建议，可调整，偏差写进报告）

```text
sense-console/src/modules/chat/
├── types.ts              ChatStreamEvent、消息 part、HTTP 请求体（按 chat.md 2.3/2.4 自行定义，不 import 其他项目）
├── transport/
│   ├── transport.ts      ChatTransport 接口：sendTurn / regenerate / answerPermission，返回 AsyncIterable<ChatStreamEvent>，支持 AbortSignal
│   ├── sse-parser.ts     fetch + ReadableStream 的 SSE 解析（忽略 ": ping"），纯函数，可单测
│   ├── http-transport.ts 按 chat.md 2.4 实现（第一波可以写好但不接真实地址）
│   └── mock-transport.ts 按脚本回放事件（含 reasoning、text、tool、permission_request、error、usage、done），可控延迟
├── services/             会话与消息读写：chat_sessions / chat_messages 走 Supabase（getSupabaseClient），mock 模式下用内存实现同一接口
├── hooks/                useChatSessions、useChatMessages、useChatTurn（流式拼接、停止、单活跃回合）
├── components/           会话侧栏、消息列表、消息气泡、输入框（Slash 菜单、@ 引用、停止按钮）、Model Selector
└── chat-page.tsx         页面入口（桌面与窄屏共用，窄屏侧栏收为 Sheet / Drawer）
```

- 传输选择：`import.meta.env.VITE_CHAT_TRANSPORT === "mock"` 时用 `mock-transport` 与内存会话服务；否则用真实实现。**不得**新增 Vite 开发服务器接口或任何 `spawn`。

### 验收标准

1. **会话**：新建、切换、重命名、归档、删除；按 `updated_at` 倒序；`/clear` 即新建会话（继承 `work_item_id`）。
2. **流式**：`text_delta` 逐字追加，安全 Markdown 渲染（复用 `@/lib/safe-markdown`，不拼接未消毒 HTML）；`reasoning_delta` Phase 1 可先以简单折叠块展示；生成中输入框变「停止」。
3. **停止与断开**：点「停止」才调用取消（mock 中模拟 `cancelled` 结束）；组件卸载 / 切换会话只断开读取，不取消（frontend.md 5.2 第 7 条）。
4. **单活跃回合**：上一轮未结束时发送按钮禁用；HTTP `409 turn_in_progress` 有对应提示。
5. **重新生成**：同一 user 消息下多条助手回复折叠为「版本 1/2/…」，默认显示最新。
6. **Slash 命令**（chat.md 2.2）：输入 `/` 弹出菜单；`/capture` `/draft` `/storyboard` `/work` 在真实模式调用对应已有 RPC / 服务（先在 `src/services/` 中查找现有封装并复用，不重复实现），mock 模式只出本地结果卡；结果卡不写入 `chat_messages`。
7. **`@` 引用**：`@` 弹出事项 / 稿件选择（真实模式查 `work_items`、`content_documents`；mock 用假数据），选中后输入框上方显示可移除芯片，发送时作为 `parts` 中的 `context_ref`。
8. **Model Selector**：按节点分组，离线节点置灰；数据源抽象为一个函数，第一波返回 mock 目录（形状同 chat.md 3.4 示例，含 `context_window`），真实读取 `runner_nodes.capabilities` 留到 DB3b 合并后。
9. **错误态**：`error` 事件显示错误与「重新生成」按钮；`budget_exceeded` 有专门文案。
10. **测试**：`sse-parser`（分包、多事件、ping、残缺行）、`useChatTurn`（流式拼接、停止、错误）、Slash 菜单与 `@` 芯片的 vitest 单测；不要求 Playwright。
11. **门禁**（全部通过）：

    ```bash
    npm --prefix sense-console install
    npm --prefix sense-console run typecheck && npm --prefix sense-console run lint
    npm --prefix sense-console run test && npm --prefix sense-console run build
    ```

### 不做

- 不删除、不修改旧的 `/chat`、`/h5/chat` 与 `chat-assistant-page.tsx`（路由切换在合并阶段由 Claude 做）。
- 不做 Phase 2 组件（`Plan`、`Task`、`Questionnaire` 权限卡、`Stack Trace`）——`permission_request` 第一波只需在 mock 中以简单「允许 / 拒绝」按钮跑通回传调用。
- 不改 `docs/` 下除 `pi-spike-result.md` 之外的文件（需要改的写进交付报告）。

## 第二波预告（等 Claude 通知再开始）

DB3b 与 R3.0 合并后：`http-transport` 接真实节点、Model Selector 读 `capabilities`、Phase 2 组件、旧页面下线与路由切换配合。届时另发简报。
