# Pi 厂商兼容 Spike 结论报告（R3.0 前置调研）

> 2026-11-24 · 在仓库外临时工程独立验证，绝不写密钥、账号与私有路径。用于指导 R3.0 在 `workers/agent/drivers/` 落地 `PiCloudDriver`。

## 1. 测试包与精确版本

| 包名 | 精确版本 | 许可 | 备注 |
| --- | --- | --- | --- |
| `@mariozechner/pi-ai` | `0.73.1` | MIT | 安装时 npm 提示该包已标记 deprecated，后续迁移包名为 `@earendil-works/pi-ai`（0.73.1 可正常使用，R3.0 引入前建议核对是否直接装新包名并锁精确版本） |
| `@mariozechner/pi-agent-core` | `0.73.1` | MIT | 同样提示后续迁移包名为 `@earendil-works/pi-agent-core` |
| `typebox`（随 `pi-ai` 自动安装） | `^1.1.24` | MIT | `@mariozechner/pi-ai` 直接导出 `{ Type }`（不再使用旧 `@sinclair/typebox`） |

## 2. 核实后的真实 API（与 `chat.md` §4.2 原假设的差异）

### 2.1 与原设计文档假设的签名差异

- **`agentLoop` 不是单对象配置传参**，而是 **位置参数**：
  `agentLoop(prompts, context, config, signal?, streamFn?) => EventStream<AgentEvent, AgentMessage[]>`。
- **事件订阅方式**：`agentLoop(...)` 返回 `EventStream`（实现 `AsyncIterable<AgentEvent>`），直接 `for await (const ev of stream)` 消费即可（若用有状态封装才使用 `new Agent().subscribe(...)`）。
- **核心事件名**：
  - `AgentEvent.type`：`agent_start`、`turn_start`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_update`、`tool_execution_end`、`turn_end`、`agent_end`。
  - 当 `ev.type === "message_update"` 时，内部 `ev.assistantMessageEvent.type` 才是细粒度增量：`text_start` / `text_delta` / `text_end`、`thinking_start` / `thinking_delta` / `thinking_end`、`toolcall_start` / `toolcall_delta` / `toolcall_end`、`done` / `error`。
- **关键类型与 Tool 定义**：`Model<"openai-completions">`、`AgentTool`（必须提供 `label: string` 与 `execute(toolCallId, params, signal, onUpdate)` 返回 `{ content: [{ type: "text", text }], details }`）、`AgentMessage`、`AssistantMessage`。
- **Usage 字段路径**：位于 `message_end`（`ev.message.role === "assistant"`）的 `ev.message.usage`，字段为 `{ input, output, cacheRead, cacheWrite, totalTokens, cost: { input, output, total } }`（非 `prompt_tokens`）。

### 2.2 最小可运行代码片段（20 行）

```ts
import { Type, type Model } from "@mariozechner/pi-ai";
import { agentLoop, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";

const model: Model<"openai-completions"> = {
  id: "qwen3.8-flash", name: "qwen3.8-flash", api: "openai-completions", provider: "qwen",
  baseUrl: process.env.SENSE_LLM_BASE_URL!, reasoning: true, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 4096,
  compat: { thinkingFormat: "qwen", supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
};
const tool: AgentTool<ReturnType<typeof Type.Object>> = {
  name: "get_time", label: "Get Time", description: "Get server ISO time",
  parameters: Type.Object({ city: Type.String() }),
  execute: async (_id, p) => ({ content: [{ type: "text", text: "2026-11-24T16:30:00+08:00" }], details: p }),
};
const convertToLlm = (ms: AgentMessage[]) => ms.filter((m): m is Extract<AgentMessage, { role: "user" | "assistant" | "toolResult" }> => m.role !== "custom");
const stream = agentLoop([{ role: "user", content: "查上海时间", timestamp: Date.now() }], { systemPrompt: "先查工具再答", messages: [], tools: [tool] }, { model, apiKey: process.env.SENSE_LLM_API_KEY!, reasoning: "low", convertToLlm }, new AbortController().signal);
for await (const ev of stream) {
  if (ev.type === "message_update" && (ev.assistantMessageEvent.type === "thinking_delta" || ev.assistantMessageEvent.type === "text_delta")) process.stdout.write(ev.assistantMessageEvent.delta);
  if (ev.type === "message_end" && ev.message.role === "assistant") console.log(ev.message.usage, ev.message.stopReason);
}
```

## 3. 各厂商 × 5 项实测结果

> 说明：仅对本机环境变量已有 Key 的厂商做真机实测；未配置 Key 的厂商如实标记为未实测，不编造结果。

| 厂商 / 模型 | 1. 流式文本 | 2. 独立 thinking 事件 | 3. Tool Loop (`get_time`) | 4. `AbortSignal` 即时中止 | 5. Token `usage` | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| **Qwen / `qwen3.8-flash`**（DashScope OpenAI 兼容端点，需显式 `compat`） | 通过（7～10 chunks） | 通过：`reasoning=undefined` 时 0 块（关闭）；`reasoning="low"` 时 33 块 `thinking_delta` | 通过（2 轮 assistant，`toolStarts=1, toolErrors=0`） | 通过（`stopReason="aborted"`，中止耗时 0～5 ms） | 通过（`input=41/77, output=23/140`） | 无显式 `compat` 会因 `developer` role 报错 400 |
| **Qwen / `qwen3.7-max`**（DashScope OpenAI 兼容端点） | 未通（鉴权/配额拦截） | 未通 | 未通 | 未通 | 未通 | 前端 `.env.local` 旧 Key 返回 `401 API-key is blocked`；worker 活跃 Key 返回 `403 Free quota exhausted` |
| **DeepSeek / `deepseek-chat`**（`api.deepseek.com`） | 通过（28 chunks） | 不涉及（`reasoning=false`，0 块） | 通过（2 轮 assistant，准确回填回答） | 通过（`stopReason="aborted"`，0 ms） | 通过（`input=27, output=28`） | `detectCompat` 自动识别 `deepseek.com` |
| **DeepSeek / `deepseek-reasoner`**（`api.deepseek.com`） | 通过（35 chunks） | 通过：`reasoning="medium"` 49 块 `thinking_delta`；`reasoning=undefined` 0 块 | 通过（2 轮 assistant，tool 循环正常） | 通过（`stopReason="aborted"`，0 ms） | 通过（`input=52, output=85`） | `model.reasoning` 必须为 `true`，否则无法传 `thinking: { type: "disabled" }` |
| **DeepSeek / `deepseek-flash`**（当前 worker eval 环境变量模型） | 通过（28 chunks） | 通过（默认开 thinking：39 块 `thinking_delta`） | 通过（2 轮 assistant） | 通过（`stopReason="aborted"`，1 ms） | 通过（`input=52, output=68`） | `model.reasoning=false` 时未下发关闭 thinking，服务端默认开启 |
| **Kimi (Moonshot)** | 未实测 | 未实测 | 未实测 | 未实测 | 未实测 | 本机未配置 API Key（静态源码可见内置 `moonshotai-cn` `maxTokensField: "max_tokens"`、`supportsStrictMode: false`） |
| **智谱 GLM (`zai`)** | 未实测 | 未实测 | 未实测 | 未实测 | 未实测 | 本机未配置 API Key（静态源码可见 `thinkingFormat: "zai"` 使用 `enable_thinking`） |

## 4. 首批推荐目录与已知坑（供 R3.0 `PiCloudDriver` 参考）

### 4.1 首批建议进 `Runtime & Model Catalog` 的厂商与模型

1. **阿里云百炼 Qwen**：首批上线 **`qwen3.8-flash`**（5 项全通过，支持流式关闭/开启 thinking）；`qwen3.7-max` 需确认账号充值/关闭仅免费额度模式后再打开。
2. **DeepSeek**：首批上线 **`deepseek-chat`** 与 **`deepseek-reasoner`**（`deepseek-flash` 亦可用作轻量/评估备选；5 项全通过）。
3. **Kimi / 智谱 GLM**：待拿到有效 API Key 完成 5 项实测后再上架目录，避免盲目开放。

### 4.2 已知坑与实现要点

1. **Qwen 必须显式传完整 `compat`（高危坑）**：`pi-ai` 的 `detectCompat()` 只识别少数预设域名，不识别 DashScope / 百炼自定义兼容端点，默认会把 `supportsDeveloperRole` 设为 `true`，导致 `model.reasoning = true` 时把 `system` 角色改写成 `developer`，DashScope 直接报 **`400 developer is not one of ['system', 'assistant', 'user', 'tool', 'function']`**。务必显式设置：
   `compat: { thinkingFormat: "qwen", supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" }`。
2. **DeepSeek 的 `model.reasoning` 开关语义**：在 `pi-ai` 中只有 `compat.thinkingFormat === "deepseek" && model.reasoning === true` 时才会向接口传 `thinking: { type: "enabled" | "disabled" }`。对思考模型，**即便当前回合用户选择关闭思考（`thinking_effort: "off"`），`model.reasoning` 也应保持 `true`、仅把 `agentLoop` 的 `reasoning` 参数传 `undefined`**，才能真正关闭思考过程。
3. **包名迁移与版本锁定**：`@mariozechner/pi-*@0.73.1` 已提示迁移至 `@earendil-works/pi-*`。R3.0 正式引入根目录 `package.json` 时建议核对新包名并去掉 `^` 精确锁版本，且把 `pi-*` 类型完全封死在 `workers/agent/drivers/pi-cloud.ts` 内部。
4. **Abort 处理**：`AbortController.abort()` 触发后 `agentLoop` 不会向外抛异常，而是平稳结束流并在最后的 `message_end` 发出 `stopReason === "aborted"` 的消息；上层 `chat-turn` 应据此判断取消并落库已收到的半截文本。
5. **`cost` 计价字段为 0**：自定义模型配置若未填 `model.cost.{input,output}`，则 `usage.cost.total` 恒为 `0`，预算核算需按节点配置单价或由 `RuntimeRegistry` 注入 `cost` 表。

## 5. 新包名 1.5.2 复核（Claude，2026-11-24，只做 API 与依赖核对，未用真实 Key）

**选型**：`@earendil-works/pi-ai@1.5.2` + `@earendil-works/pi-agent-core@1.5.2`（2026-11-10 发布，满两周的最新版；1.6.0 发布于 2026-11-20，暂不用）。在仓库外临时目录 `--ignore-scripts` 安装，按下列改动后最小片段 `tsc --strict` 通过，`agentLoop` / `streamSimple` 运行时可正常导入。

| # | 0.73.1（第 2 节）的写法 | 1.5.2 的实际 API | 对 `PiCloudDriver` 的影响 |
| --- | --- | --- | --- |
| 1 | `agentLoop(prompts, context, config, signal?)` | `agentLoop(prompts, context, config, signal \| undefined, streamFn)`，**第 5 个参数必填** | 传 `streamSimple`（从 `@earendil-works/pi-ai/compat` 导入，主入口不导出） |
| 2 | `context.systemPrompt` | `AgentContext` 只有 `{ messages, tools? }`；系统提示是 `role: "system"` 的消息，且所有消息必须带 `timestamp` | 与 `TurnInput.messages`（首条为 system）直接对应，逐条补 `timestamp` |
| 3 | `import { Type } from "pi-ai"`（TypeBox） | 不再导出 `Type`；schema 构造器移到 `@earendil-works/pi-schema`；`Tool.parameters` 类型为任意 `object` | `ChatToolSpec.inputSchema`（JSON Schema）原样作为 `parameters`，不引入 schema 库 |
| 4 | `convertToLlm` 过滤 `custom` 角色 | `Message` 新增 `SystemMessage`；不使用自定义消息时可直接透传 | 透传即可 |
| 5 | — | 新增 `beforeToolCall(ctx) → { block, reason }` | `TurnHost.requestPermission` 在这里接：拒绝即 `block: true` |
| 6 | — | 新增 `finishTurn(turn) → { action: "continue" \| "end" }`，在每次助手回合（含工具结果）之后、下一次请求之前调用 | `TurnHost.beforeModelCall()` 在这里接：不通过就 `end`；首个请求前由驱动先调一次 |

其余（`message_update` 下的 `text_delta` / `thinking_delta`、`tool_execution_*`、`message_end` 上的 `usage` 与 `stopReason`、`Model<"openai-completions">` 的 `compat` 字段）类型层面与第 2 节一致。

**依赖面**：`pi-ai@1.5.2` 依赖 Anthropic、OpenAI、Google GenAI、AWS Bedrock 四家 SDK（另有 lazy 入口按需加载），worker 镜像会变大；`@earendil-works/pi-telemetry` 只是本地遥测 schema 与观察钩子，源码中无任何网络调用或环境变量开关，不外发数据。

**仍需 R3.0 真机复测**：第 3 节的 5 项厂商实测是在 0.73.1 上做的。R3.0 接线后用 `deepseek-chat` / `deepseek-reasoner` / `qwen3.8-flash` 在 1.5.2 上重跑这 5 项（尤其是 Qwen `compat` 与 DeepSeek `reasoning` 两个坑），结果补到本节。
