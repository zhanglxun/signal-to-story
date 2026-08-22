---
name: video-factory
description: >-
  AI 视频分镜生成与极速成片流水线：基于 Audio-First 旁白对齐、分镜关键帧、本地 FFmpeg 运镜/云端 AI 视频模型 (万相/MiniMax/Seedance) 混合渲染、BGM 避让混音、多轨 SFX 拟音与字幕压制，实现一键自动化或分步视频生产与迭代。
---

# Video Factory: AI 视频自动化生成与迭代 Skill

> **定位**：Signal to Story 的底层视频执行引擎与生产规范，负责从剧本大纲到成片输出的全链路自动化编排。

---

## 1. 核心设计原则

1. **Audio-First 旁白主时钟**：视频镜头时长以生成的配音音频精确毫秒时长为准，根治音画脱节。
2. **多轨声音分层 (Multi-track Audio Separation)**：
   - **旁白轨 (Voiceover)**：主导叙事与时间轴；
   - **拟音音效轨 (SFX)**：每个镜头独立拟音（引擎声、晶体碰撞、烟花爆鸣），提升沉浸感；
   - **背景音乐轨 (BGM)**：支持 **Audio Ducking 智能避让**（有旁白时 BGM 自动降低至 9%，无旁白时自然升起）。
3. **视觉物料分层与混合镜头**：
   - 静态图、架构图、卡片走本地 FFmpeg Ken Burns 平滑运镜（0 成本、毫秒级渲染、画质无损）；
   - 真实高动态镜头按需调用云端模型（通义万相、MiniMax、Seedance 等）。
4. **两阶段生产流**：
   - Phase 1：生成分镜表 + 配音 + 静态关键帧 + SFX 音效（低成本审阅故事板）；
   - Phase 2：确认关键帧后再启动动态化与成片合成。
5. **多项目物理隔离**：每个项目在 `projects/<project_id>/` 下独立维护中间资产与审计报告。

---

## 2. 常用执行命令

工程根目录：`signal-to-story/sense-console/video-factory/`

```bash
# 激活环境
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PYTHONPATH=src

# 1. 一键全流程跑通项目
python3 src/pipeline.py --project <project_id>

# 2. 单独生成/更新配音与字幕
python3 src/audio_engine.py --plan projects/<project_id>/video_plan.json

# 3. 单独生成 SFX 音效
python3 -c "from sfx_generator import generate_all_sfx_for_project; generate_all_sfx_for_project('projects/<project_id>')"

# 4. 单独生成各个分镜视频片段 (本地运镜 / 万相 AI 视频)
python3 src/video_engine.py --plan projects/<project_id>/video_plan.json

# 5. 多轨音视频剪辑合成 (包含 BGM Ducking 混音、SFX 与字幕)
python3 src/composer.py --plan projects/<project_id>/video_plan.json --bgm assets/bgm/cheerful_fantasy.mp3
```

---

## 3. 模型驱动层与可用模型池 (Model Pool)

### 已调通接入的模型：
1. **通义万相 2.7 视频生成（DashScope）**：
   - `wan2.7-t2v-2026-06-12`：文生视频 (Text-to-Video)，生成 5 秒 1080P 高清动态视频；
   - `wan2.7-r2v-2026-06-12`：参考图生视频 (Reference-to-Video / I2V)；
   - `wan3.0-video` / `happyhorse-1.1-t2v` / `happyhorse-1.1-r2v`：备选视频通道。
2. **通义千问 LLM (Token Plan / OpenAI Compatible)**：
   - `qwen3.7-max`：负责剧本大纲到结构化分镜 JSON 的智能拆解。
3. **本地动效引擎（Local Engine）**：
   - `LocalKenBurnsAdapter`：FFmpeg 本地 0 成本高画质运镜。

---

## 4. 迭代记录与沉淀 (Changelog)

* **v1.2 (2026-08-22)**：
  - 完成 **Demo 002**（万相 2.7 真实 AI 动态视频 + 多轨音效分层制作）；
  - 接入通义万相 2.7 真实视频生成（Shot 1~4 全动态渲染）；
  - 新增 `sfx_generator.py`（飞船轰鸣、跳跳糖晶体声、烟花爆鸣等独立音效轨）；
  - 剪辑合成器升级支持 **多轨独立混音**（Voiceover + BGM Ducking + SFX）；
  - 生成 `final_video.mp4`（32MB 高画质成片）。
* **v1.1 (2026-08-22)**：
  - 成功调通通义万相 2.7 视频生成 API；
  - 接入 `WanxAdapter` 并支持按分镜路由调度；
  - 调通 Token Plan `qwen3.7-max` 认知大脑；
  - 修复根目录 `.gitignore` 保护环境配置。
* **v1.0 (2026-08-22)**：
  - 完成 Phase 1 基础引擎落地；
  - 接入 Edge-TTS 音频与毫秒级字幕时间轴自动生成；
  - 落地本地 FFmpeg Ken Burns 0 成本平滑运镜引擎；
  - 跑通首个 30s 儿童奇幻短片 Demo 《小宇航员的星际糖果星》。
