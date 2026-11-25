# Agent Harness Worker

独立进程，消费 `public.agent_jobs`，执行「Context Pack → 生成 → 确定性预检 → 独立 LLM 评估 → 重写（≤ max_rounds）→ 直接写入草稿 / 转人工」。设计与接口见 [docs/modules/harness.md](../../docs/modules/harness.md)。

- 只做 outbound 连接（Supabase HTTPS + 模型 API），没有监听端口。
- 只持有**公开 key + 节点令牌**（DB2c-2），所有读写都走 `node_*` RPC：只能认领本组织的任务、只能写自己正在执行的任务；不能批准、不能写知识库/决定记忆、不能写发布记录（数据库拒绝）。不需要也不应该配置 `service_role`。
- 产出经 `node_write_document_draft` 校验 `base_revision` 后直接写入 `content_documents` 新草稿版本（DB2c-3；若期间人工改过稿件则拒绝覆盖并转失败 `stale_target`），任务置为 `pending_review`，人工在控制台复核通过后任务自动转为 `succeeded`。

## 运行

```bash
# 在仓库根目录执行（根 package.json 提供运行时依赖与命令）
npm install
# 先在控制台「本地 Agent → 执行节点」新建节点，令牌只显示一次
cp workers/agent/.env.example /secure/place/agent-worker.env   # 填 SUPABASE_URL、SUPABASE_PUBLISHABLE_KEY、SENSE_NODE_TOKEN 与模型配置，勿提交
set -a; source /secure/place/agent-worker.env; set +a
npm run worker:agent
```

`SIGINT` / `SIGTERM`：停止认领新任务并中止当前调用；不写失败状态，租约过期后任务重新排队，并从最后一个已落库步骤恢复。

## 两种部署方式（同一份代码）

1. **云端容器（默认）**：`workers/agent/Dockerfile`（构建上下文为仓库根目录），环境变量由平台 Secret 注入。水平扩展＝多跑几个进程/副本（每个进程一次一个任务，`SKIP LOCKED` 保证不重复）。
2. **个人电脑作为本地算力节点**：在本机直接 `npm run worker:agent`。适合复用本机已登录的 CLI（`SENSE_LLM_DRIVER=cli`）。只需出站网络、无需公网 IP。建议：
   - 用 `SENSE_WORKER_JOB_TYPES` 只认领需要本机能力的任务类型；
   - 每台机器一个节点（控制台里能看到在线状态，任务表 `node_id` 记录是谁在执行），`SENSE_WORKER_ID` 只用于日志；
   - 机器丢了或令牌泄露：在控制台吊销该节点，令牌立即失效，正在跑的任务租约过期后重新排队。

## 驱动

| 驱动 | 状态 | 说明 |
| --- | --- | --- |
| Cloud（OpenAI 兼容） | 可用 | Qwen / Kimi / DeepSeek / GLM / MiniMax / 自建网关。429 与“请求未发出”的网络错误可重试；超时、5xx、空输出视为**可能已计费**，不自动重试。 |
| `codex-cli` | 可用（参数已核对 `codex exec --help`，codex-cli 0.167.2） | `codex exec --skip-git-repo-check --ephemeral --sandbox read-only --color never -C <临时空目录> -o <最终消息文件> -`，prompt 走 **stdin**；子进程 env 为白名单（`PATH HOME LANG LC_ALL TMPDIR CODEX_HOME`），超时 SIGTERM→SIGKILL。尚未在本仓库测试中真实调用 codex（会产生费用），仅用假 spawn 验证。 |
| Pi（Chat，`drivers/pi-cloud.ts`） | 已接线，仅假 `streamFn` 测试 | Chat 回合的 `AgentSessionDriver`；配置见下方「运行时目录」。尚未用真实 Key 在 1.5.2 上复测厂商兼容。 |
| `pi-cli` / `opencode-cli` / `agy-cli` | **未验证参数**，worker 拒绝使用 | 注册表保留；接入前需按各自 `--help` 验证 stdin/无交互参数后把 `verified` 置为 true。 |

## 运行时目录

Chat 用的云端 API 运行时（`PiCloudDriver`，基于 `@earendil-works/pi-*@1.5.2`）由 `runtime-registry.ts` 从环境变量读取，一个节点可同时配多个 Profile。与出稿用的 `SENSE_LLM_*` / `SENSE_EVAL_LLM_*` 互不影响。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SENSE_API_RUNTIMES` | 是 | 逗号分隔的 Profile 名（字母、数字、下划线），如 `qwen_flash,deepseek_chat` |
| `SENSE_RUNTIME_<PROFILE>_PROVIDER` | 是 | `qwen` / `kimi` / `deepseek` / `zhipu` / `minimax` / `openai-compatible` |
| `SENSE_RUNTIME_<PROFILE>_MODEL` | 是 | 发给厂商的模型 id |
| `SENSE_RUNTIME_<PROFILE>_API_KEY` | 否 | 未填时用 `SENSE_PROVIDER_<PROVIDER>_API_KEY`（同厂商多个模型共用一把 Key）；都没有则目录里标 `unavailable` |
| `SENSE_RUNTIME_<PROFILE>_BASE_URL` | 否 | 未填时用 `SENSE_PROVIDER_<PROVIDER>_BASE_URL`，再退回厂商默认地址；不能内嵌账号密码 |
| `SENSE_RUNTIME_<PROFILE>_LABEL` | 否 | 控制台显示名，默认「厂商名 · 模型」 |
| `SENSE_RUNTIME_<PROFILE>_REASONING` | 否 | 思考型模型填 `true`（默认 `false`）；用户关闭思考时只把本轮 `reasoning` 传空，模型标记不变 |
| `SENSE_RUNTIME_<PROFILE>_CONTEXT_WINDOW` / `_MAX_OUTPUT_TOKENS` | 否 | 默认 32768 / 4096，用于上下文截断 |
| `SENSE_RUNTIME_<PROFILE>_INPUT_CENTS_PER_1K` / `_OUTPUT_CENTS_PER_1K` | 否 | 单价（分 / 千 token）；都不填则按 0 计、目录标 `priced: false`，只受 `max_rounds` 约束 |
| `SENSE_RUNTIME_<PROFILE>_TIMEOUT_MS` | 否 | 单次请求超时 |

运行时 id 为 `api:<provider>:<model>`（模型名转小写，非法字符换成 `-`）。DashScope 端点自动带完整 Qwen `compat`，DeepSeek 自动带 `thinkingFormat: "deepseek"`。

示例（值均为占位，勿提交真实 Key）：

```bash
SENSE_API_RUNTIMES=qwen_flash,deepseek_chat,deepseek_reasoner
SENSE_RUNTIME_QWEN_FLASH_PROVIDER=qwen
SENSE_RUNTIME_QWEN_FLASH_MODEL=qwen3.8-flash
SENSE_RUNTIME_QWEN_FLASH_API_KEY=<dashscope-key>
SENSE_RUNTIME_QWEN_FLASH_REASONING=true
SENSE_RUNTIME_QWEN_FLASH_CONTEXT_WINDOW=131072
SENSE_PROVIDER_DEEPSEEK_API_KEY=<deepseek-key>
SENSE_RUNTIME_DEEPSEEK_CHAT_PROVIDER=deepseek
SENSE_RUNTIME_DEEPSEEK_CHAT_MODEL=deepseek-chat
SENSE_RUNTIME_DEEPSEEK_REASONER_PROVIDER=deepseek
SENSE_RUNTIME_DEEPSEEK_REASONER_MODEL=deepseek-reasoner
SENSE_RUNTIME_DEEPSEEK_REASONER_REASONING=true
```

节点上报的能力目录只含 `id / kind / provider / model / label / capabilities / context_window / max_output_tokens / priced / status`，不含 Key、Base URL 与令牌（构造后再按已配置的 Key 逐一比对兜底）。上报接口 `CapabilityReporter` 目前只有内存假实现，接 `node_report_capabilities` 在 T3b 完成。

## 本地演示 / 验收

```bash
npm run demo:harness
```

PGlite + 全量迁移 + fake LLM：场景 1 评估先失败后通过 → 直接写入稿件 v2 + `pending_review`；场景 2 三轮不过 → `blocked_needs_human`。若环境里配置了 `SENSE_LLM_*`，场景 1 改用真实模型（会产生费用）。

## 通知

IM 通知不在任务结束时内联发送：worker 主循环每 15 秒（`notifyIntervalMs`）调用 `list_pending_notices`，把需要人处理的任务、待批准和 Agent 提问发到来源会话（`intake_events.payload.reply_to`），发送成功后 `mark_notice_sent` 写 `notified_at`；发送失败不标记，下一轮重试。没有 IM 来源或本机没配该通道凭证的记录直接标记，不发送。
