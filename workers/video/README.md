# Video Worker（P5 视频工坊执行端）

独立 Python 进程，认领 `agent_jobs` 中的 `video_tts_preview` / `video_shot_render` / `video_compose`，调用 `engine/`（原 `sense-console/video-factory`，现为 Python 包 `engine`）生成产物，上传私有 bucket `video-studio`，回写 `assets`（`asset_type='video_studio'`）、`video_shots` 渲染状态、`video_cost_entries` 成本账本，再 `complete/fail`。只出站连接，无监听端口。

| 文件 | 作用 |
| --- | --- |
| `worker.py` | CLI：`--backend rest|stdio`、`--engine dry-run|dry-run-no-ffmpeg|video-factory`、`--dry-run`、`--once` |
| `video_worker/contract.py` | 契约校验（`contract/video-job.schema.json`，由 zod 生成：`npm --prefix sense-console run video:contract`）、Audio-First 对齐、成本估算（与 TS 同一套 fixture） |
| `video_worker/engines.py` | 可注入引擎：`DryRunEngine`（零付费：静音 WAV、纯色 PNG、本地 Ken Burns / Composer 或占位文件）、`VideoFactoryEngine`（edge-tts、Ken Burns、**Wanx 付费**、Composer） |
| `video_worker/backend.py` | `RestBackend`（PostgREST + Storage，service_role）与 `StdioBackend`（JSON 行协议，供 `demo:video` 接 PGlite） |
| `video_worker/processor.py` | 认领一条任务：版本校验 → 锁定（`rendering`）→ 配音 → Audio-First 对齐 → 渲染 → 上传 → 回写 → 完成 |

## 规则

- **批准**：付费判定在数据库（见 `docs/modules/harness.md` §4 与 `docs/modules/video.md`）。worker 不判断、不能批准；付费任务未批准时根本无法入队/认领。
- **付费失败不自动重试**：`EngineError(billable=True)` → `fail_agent_job(retryable=false)`。edge-tts / 网络 / 数据库错误可重试。
- **版本**：任务绑定计划 revision（`payload.target = {type: video_plan, id, revision}`）；认领后与锁定后各校验一次，不一致 → `failed/stale_target`。渲染中分镜被数据库锁定，不能改稿。
- **租约**：认领返回 `lease_epoch`，心跳、完成、失败都带上它；任务被别的节点重新认领后，旧进程的写入一律被数据库拒绝。后台线程每 `lease/3` 秒续租；`cancel_requested` 在步骤边界停止（`cancelled`）；租约丢失则不再写入。SIGINT/SIGTERM 停止认领。
- 关键帧：镜头未关联关键帧时，dry-run 生成纯色占位；真实引擎对本地运镜直接失败（关键帧生图是付费能力，未接自动生成）。

## 运行

```bash
# 在仓库根目录执行
npm run test:video-worker                 # python3 -m unittest（19 个用例，无需网络/密钥）
npm run demo:video                        # PGlite + fake LLM + 本 worker（stdio, dry-run）全链路
# 对真实 Supabase（勿提交密钥）：
set -a; source /secure/place/video-worker.env; set +a     # 变量见 .env.example
python3 workers/video/worker.py --dry-run                  # 不调用任何付费 API
python3 workers/video/worker.py --engine video-factory     # 真实引擎；需 engine/requirements.txt 与 DASHSCOPE_API_KEY
```

依赖：标准库即可运行；`jsonschema` 可选（缺失时用内置校验）；真实引擎需要 `engine/requirements.txt`，其模块均为延迟导入。容器镜像见 `Dockerfile`（构建上下文为仓库根目录）。
