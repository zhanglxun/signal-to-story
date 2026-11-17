# Agent Harness Worker

独立进程，消费 `public.agent_jobs`，执行「Context Pack → 生成 → 确定性预检 → 独立 LLM 评估 → 重写（≤ max_rounds）→ 提案 / 转人工」。设计与接口见 [docs/modules/harness.md](../../../docs/modules/harness.md)。

- 只做 outbound 连接（Supabase HTTPS + 模型 API），没有监听端口。
- 只使用 `service_role` 调受控 RPC 与少数表；不能批准、不能写知识库/决定记忆、不能改正式稿件、不能写发布记录（数据库拒绝）。
- 产出写入 `content_ai_proposals`（`status=succeeded`、`agent_job_id`），任务置为 `pending_review`，由人工在现有提案采纳流程中处理。

## 运行

```bash
# 在仓库根目录执行（根 package.json 提供运行时依赖与命令）
npm install
cp workers/agent/.env.example /secure/place/agent-worker.env   # 填真实值，勿提交
set -a; source /secure/place/agent-worker.env; set +a
npm run worker:agent
```

`SIGINT` / `SIGTERM`：停止认领新任务并中止当前调用；不写失败状态，租约过期后任务重新排队，并从最后一个已落库步骤恢复。

## 两种部署方式（同一份代码）

1. **云端容器（默认）**：`workers/agent/Dockerfile`（构建上下文为仓库根目录），环境变量由平台 Secret 注入。水平扩展＝多跑几个进程/副本（每个进程一次一个任务，`SKIP LOCKED` 保证不重复）。
2. **个人电脑作为本地算力节点**：在本机直接 `npm run worker:agent`。适合复用本机已登录的 CLI（`SENSE_LLM_DRIVER=cli`）。只需出站网络、无需公网 IP。建议：
   - 用 `SENSE_WORKER_JOB_TYPES` 只认领需要本机能力的任务类型；
   - `SENSE_WORKER_ID` 设成可识别的机器名，方便在任务中心看出是谁执行的；
   - service_role 密钥等同数据库最高权限，仅放在你自己控制的机器上。多租户 SaaS 场景下应改为按组织签发的受限 worker 凭证（尚未实现）。

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
