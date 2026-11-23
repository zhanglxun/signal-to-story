# 视频工坊

> 由旧 PRD 的 FR-05、V2 计划的 P5 和 `workers/video/README.md` 精简而来。运行方法见 `workers/video/README.md`。

## 1. 流程

大纲 → 分镜任务（harness 循环输出 `VideoPlan` JSON，经结构校验）→ **AI 直接写入草稿计划与镜头**（`write_video_draft`，按任务幂等，挂在事项卡上）→ 人编辑镜头（台词、音色、运镜、关键帧资产）→ 服务端估算费用 → 超过阈值需要 `paid_video_render` 批准（预估写在批准的 `payload.estimated_cost_cents`）→ 视频 worker 配音、渲染、合成 → 产物上传对象存储并登记 `assets` → 实际费用写入任务 `result.cost_cents`。

## 2. 表（DB5 定版，随最终批次上线）

- `video_plans`：分镜方案，带 `revision`，挂 `work_item_id`。
- `video_shots`：镜头，包括景别、运镜（`local_ken_burns` 或云端视频模型）、旁白、毫秒时长、音效描述、关键帧和产物资产、渲染状态。
- 不建成本账本（R6）：分镜提案表、`video_cost_entries`、成本视图已删除；镜头没有成本列，`render_status` 就是进度。

## 3. 规则

- **成本门禁**：本地 Ken Burns 预览和 Edge TTS 试听不花钱，不用批准；云端视频模型、或估算超过 10 分（`private.video_cost_rate('free_threshold')`）的任务需要批准，决定人需有 `agent.approve`。同一批准下所有任务的估算合计不能超过批准额度。
- **版本**：计划的 revision 变化会让旧批准失效；排队中的任务认领时发现版本已变，直接 `failed/stale_target`。渲染期间镜头被锁定，不能改。
- **付费失败不自动重试**；edge-tts、网络和数据库错误可以重试。
- **Audio-First**：以旁白时长为主时钟对齐画面。合成时以旁白为主轨，叠加音效，背景音乐自动压低（ducking）。
- **契约**：TS 的 zod schema 用 `npm run video:contract` 生成 Python 端的 JSON Schema，两边共用同一套 fixture。

## 4. 现状与缺口

- 只跑通了 dry-run 引擎（纯色关键帧、静音音频、占位成片）。真实引擎需要 `DASHSCOPE_API_KEY`，从未在本项目中真实计费运行。
- 没做：关键帧自动生成、云端 TTS、图形化多轨时间线、拖拽排序。
- 控制台里角色、场景、画布、脚本这几页仍是 mock 演示页。

## 5. 0.5 调整方向

- ~~DB5：挂 `work_item_id`、AI 直接写草稿、删除提案与账本~~（2026-11-26 完成，最终批次）。
- 视频 worker 仍用 `service_role`，切换节点令牌留待后续。
- ~~`sense-console/video-factory` 移到 `workers/video/engine`~~（R1 已完成：Python 包 `engine`，worker 用 `from engine.composer import ...`，不再修改 `sys.path`；demo 项目在 `engine/projects/`，生成的媒体不进 git；含硬编码密钥的 `download_wanx_shots.py` 与两个 DashScope 测试脚本已删除）。
- mock 演示页标为演示或下线，不再和真实页面混在一起。
