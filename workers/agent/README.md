# Agent Harness Worker

独立进程，消费 `public.agent_jobs`，执行「Context Pack → 生成 → 确定性预检 → 独立 LLM 评估 → 重写（≤ max_rounds）→ 提案 / 转人工」。设计与接口见 [docs/modules/harness.md](../../../docs/modules/harness.md)。

- 只做 outbound 连接（Supabase HTTPS + 模型 API），没有监听端口。
- 只持有**公开 key + 节点令牌**（DB2c-2），所有读写都走 `node_*` RPC：只能认领本组织的任务、只能写自己正在执行的任务；不能批准、不能写知识库/决定记忆、不能改正式稿件、不能写发布记录（数据库拒绝）。不需要也不应该配置 `service_role`。
- 产出写入 `content_ai_proposals`（`status=succeeded`、`agent_job_id`），任务置为 `pending_review`，由人工在现有提案采纳流程中处理。

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
| `pi-cli` / `opencode-cli` / `agy-cli` | **未验证参数**，worker 拒绝使用 | 注册表保留；接入前需按各自 `--help` 验证 stdin/无交互参数后把 `verified` 置为 true。 |

## 本地演示 / 验收

```bash
npm --prefix sense-console run demo:harness
```

PGlite + 全量迁移 + fake LLM：场景 1 评估先失败后通过 → 提案 + `pending_review`；场景 2 三轮不过 → `blocked_needs_human`。若环境里配置了 `SENSE_LLM_*`，场景 1 改用真实模型（会产生费用）。

## 通知

IM 通知不在任务结束时内联发送：worker 主循环每 15 秒（`notifyIntervalMs`）调用 `list_pending_notices`，把需要人处理的任务、待批准和 Agent 提问发到来源会话（`intake_events.payload.reply_to`），发送成功后 `mark_notice_sent` 写 `notified_at`；发送失败不标记，下一轮重试。没有 IM 来源或本机没配该通道凭证的记录直接标记，不发送。
