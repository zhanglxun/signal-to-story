---
slug: video-storyboard-sop
title: AI 视频工坊分镜拆解与多轨配音 SOP
category: sop
tags: [video, storyboard, wanx, tts, ffmpeg]
updated_at: 2026-11-15
---

# AI 视频工坊分镜拆解与多轨配音 SOP

1. **黄金前 3 秒 Hook**：第 1 个镜头（Shot 001）必须直击视觉奇观或核心冲突问题，禁止平淡寒暄。
2. **Audio-First 旁白主时钟**：每个分镜的画面持续时长严格对齐 TTS 旁白音频的真实毫秒时长。
3. **冷热混合运镜策略**：
   - 概念架构图、静态高精插画优先使用本地 `LocalKenBurns` 平滑推拉运镜（0 成本、无损画质）；
   - 高动态角色动作、奇幻场景按需调用 `wan2.7-t2v` 或 `wan2.7-r2v` 渲染 5 秒高清动态片段。
4. **多轨声音分层**：旁白轨（主导叙事）+ 独立 SFX 拟音轨（增强关键动作沉浸感）+ BGM 轨（启用 Audio Ducking 自动避让旁白）。
