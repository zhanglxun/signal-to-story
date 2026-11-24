# 任务简报 · Gemini 4 · 第二波 A：Chat UI Phase 2（仍用假传输）

> 2026-11-24 · 第一波已验收合并（`f24578b`）。分工与规则不变，见 [parallel-plan.md](parallel-plan.md)。你的新分支 `feat/chat-ui-2`（从合并后的 `0.5.0` 切出），worktree 仍为 `../sts-chat-ui`。合并、验收由 Claude 负责。

## 启动提示词（用户整段发给 Gemini）

```text
你在 signal-to-story 仓库的 worktree ../sts-chat-ui 中工作，当前分支 feat/chat-ui-2（从已合并你第一波成果的 0.5.0 切出）。
先阅读：docs/tasks/brief-gemini-wave2a.md（本简报）、docs/modules/chat.md 第 2.3 节（含新增的「字段取值」冻结段）与 2.5 节、
docs/conventions/frontend.md 第 5 节、docs/tasks/parallel-plan.md。

第一波合并时 Claude 做了一处协议对齐（提交 3157c67）：permission options 改为 { id, label, kind } 对象、decision 增加 "timeout"、
运行时 kind 去掉 "cli"。先 git log -p 3157c67 看清楚，后续沿用。

按本简报完成 Phase 2 与评审遗留项。规则与第一波相同：只改 sense-console/src/modules/chat/** 与 App.tsx 中 /chat-next 那一条路由；
不引入新依赖、不引入 @radix-ui/*；不碰旧 /chat 页面、workers/、supabase/、docs/（文档改动写进交付报告）；
只在 feat/chat-ui-2 提交，不 push、不 merge。完成后按 parallel-plan.md 第 5 节格式交付报告。
```

## 任务

### 1. Phase 2 组件（frontend.md 5.3）

用 `src/components/ui/` 已有原语组合实现，Base UI 写法（`render={...}`），不手搓平行组件：

| 组件 | 数据来源 | 验收 |
| --- | --- | --- |
| `Plan` 计划卡 | `plan_update` 事件 / `plan` part | 步骤状态四种取值各有样式（语义色）；同一消息只有一张计划卡，后续更新原地替换 |
| `Task` 工具卡 | `tool_start` / `tool_end`，`tool_call` part | 运行中 / 成功 / 失败三态；输入摘要与输出摘要可折叠；失败时显示 `error` |
| `Stack Trace` 折叠 | `tool_call.stackTrace`、`error.stack` | 默认收起，展开后等宽字体、可复制；只在有栈时出现 |
| `Questionnaire` 权限卡 | `permission_request` / `permission` part | 按 `options` 渲染按钮（按 `kind` 区分主次样式），不再写死允许 / 拒绝；已决定后显示结果徽标（含「已超时（按拒绝处理）」）；回答走 `transport.answerPermission` |

mock 传输补齐能演示以上全部状态的脚本（含工具失败带栈、权限超时）。

### 2. 第一波评审遗留

1. **`/chat-next` 移入 `<RequireAuth />`**：生产构建下由路由守卫统一处理登录，页面内不再自己跳 `/login`。mock 预览改为：`VITE_CHAT_TRANSPORT=mock` 时 `RequireAuth` 外另挂一条仅 mock 模式存在的路由，或测试中直接渲染 `ChatPage`（二选一，报告中说明）。
2. **SSE 解析器 CRLF 跨分块**：一个分块以 `\r` 结尾、下一分块以 `\n` 开头时，当前实现会多出一个空行导致误切分。修复并补单测。
3. **停止后的「生成中」占位**：点停止后，worker 落库是异步的，立刻刷新可能还读不到助手消息。对状态为生成中的回合（本地已停止但尚未看到落库消息）显示占位，并通过 Supabase Realtime 订阅 `chat_messages` 插入（真实模式）或轮询（每 2 秒，最多 60 秒）直到出现；mock 模式模拟延迟落库验证。重新进入会话时，若该会话有 `queued` / `running` 的 `chat_turn`（查 `agent_jobs`），同样显示占位。

### 3. 测试与门禁

- 为 4 个 Phase 2 组件、CRLF 修复、占位逻辑补 vitest 单测。
- 门禁：`npm --prefix sense-console run typecheck && … lint && … test && … build` 全部通过。

## 不做

- 不接真实 HTTP 节点、不读 `runner_nodes.capabilities`（等 DB3b 与 Claude 的 HTTP 入口，届时另发「第二波 B」简报）。
- 不切换 `/chat`、`/h5/chat` 路由，不删除旧页面。
