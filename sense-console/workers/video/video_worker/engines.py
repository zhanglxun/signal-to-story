"""Injectable engine adapters.

* DryRunEngine — never calls a paid API. Audio: silent WAV with the estimated narration length (stdlib `wave`).
  Keyframe: solid-colour PNG (stdlib zlib). Clips: video-factory's zero-cost LocalKenBurnsAdapter when ffmpeg exists
  (cloud shots are substituted locally and flagged), otherwise a labelled placeholder text file. Compose: video-factory
  Composer when ffmpeg exists, otherwise a placeholder.
* VideoFactoryEngine — the real engine: edge-tts (AudioEngine), LocalKenBurnsAdapter, WanxAdapter (PAID), Composer.

video-factory modules are imported lazily so the worker (and its tests) run without its third-party dependencies.
"""

from __future__ import annotations

import json
import shutil
import struct
import sys
import wave
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

VIDEO_FACTORY_SRC = Path(__file__).resolve().parents[3] / "video-factory" / "src"
CHARS_PER_SECOND = 4.5


class EngineError(RuntimeError):
    """billable=True: the provider may have charged; the job must not be retried automatically."""

    def __init__(self, message: str, *, billable: bool = False, retryable: bool = False, code: str = "engine_error"):
        super().__init__(message)
        self.billable = billable
        self.retryable = retryable and not billable
        self.code = code


@dataclass
class MediaResult:
    path: Path
    mime_type: str
    duration_ms: Optional[int]
    cost_cents: float = 0.0
    placeholder: bool = False
    provider: str = "local"
    warnings: List[str] = field(default_factory=list)


@dataclass
class ShotSpec:
    shot_id: str
    position: int
    motion_mode: str
    camera_motion: str
    visual_prompt: str
    narration: str
    voice: str
    render_ms: int
    cloud_clip_seconds: Optional[int]
    aspect_ratio: str


def resolution_for(aspect_ratio: str, preview: bool) -> str:
    if preview:
        return {"9:16": "360x640", "16:9": "640x360", "1:1": "480x480"}.get(aspect_ratio, "360x640")
    return {"9:16": "1080x1920", "16:9": "1920x1080", "1:1": "1080x1080"}.get(aspect_ratio, "1080x1920")


def estimate_narration_ms(text: str) -> int:
    chars = len((text or "").strip())
    return max(800, int(round(chars / CHARS_PER_SECOND * 1000))) if chars else 0


def write_silent_wav(path: Path, duration_ms: int, rate: int = 16000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(rate * max(duration_ms, 1) / 1000)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * frames)


def write_solid_png(path: Path, width: int, height: int, rgb=(52, 68, 85)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    row = b"\x00" + bytes(rgb) * width
    raw = row * height

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def _import_video_factory():
    if str(VIDEO_FACTORY_SRC) not in sys.path:
        sys.path.insert(0, str(VIDEO_FACTORY_SRC))


def _ken_burns(ffmpeg: str):
    _import_video_factory()
    from adapters.local_kenburns import LocalKenBurnsAdapter  # type: ignore  # noqa: E402

    return LocalKenBurnsAdapter(ffmpeg_path=ffmpeg)


def _compose_with_factory(ffmpeg: str, clips: List[MediaResult], audios: List[Optional[MediaResult]], work: Path, resolution: str, bgm: Optional[str]) -> Dict[str, Any]:
    """Stage a video-factory project directory and call Composer.assemble (no rewrite of the engine)."""
    _import_video_factory()
    from composer import Composer  # type: ignore  # noqa: E402

    project = work / "compose_project"
    (project / "shots").mkdir(parents=True, exist_ok=True)
    (project / "audio").mkdir(parents=True, exist_ok=True)
    shots = []
    for idx, clip in enumerate(clips, 1):
        sid = f"shot_{idx:03d}"
        shutil.copyfile(clip.path, project / "shots" / f"{sid}.mp4")
        entry: Dict[str, Any] = {"id": sid, "output_video": f"shots/{sid}.mp4"}
        audio = audios[idx - 1]
        if audio is not None and audio.path.suffix in (".wav", ".mp3"):
            shutil.copyfile(audio.path, project / "audio" / f"{sid}{audio.path.suffix}")
            entry["audio_file"] = f"audio/{sid}{audio.path.suffix}"
        shots.append(entry)
    total = sum((c.duration_ms or 0) for c in clips) / 1000
    plan = {"project_id": "worker", "title": "worker", "meta": {"target_resolution": resolution, "total_duration_sec": total}, "shots": shots}
    plan_path = project / "video_plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    composer = Composer(ffmpeg_path=ffmpeg, ffprobe_path=shutil.which("ffprobe") or "ffprobe")
    return composer.assemble(str(plan_path), str(project), bgm_path=bgm)


class DryRunEngine:
    name = "dry-run"
    dry_run = True

    def __init__(self, ffmpeg: Optional[str] = None, use_ffmpeg: bool = True):
        self.ffmpeg = (ffmpeg or shutil.which("ffmpeg")) if use_ffmpeg else None

    def synthesize(self, text: str, voice: str, out: Path) -> MediaResult:
        duration = estimate_narration_ms(text)
        path = out.with_suffix(".wav")
        write_silent_wav(path, duration or 500)
        return MediaResult(path, "audio/wav", duration, 0.0, True, "dry-run", [f"dry-run: silent voiceover for voice {voice}"])

    def keyframe(self, spec: ShotSpec, out: Path) -> MediaResult:
        w, h = (int(x) for x in resolution_for(spec.aspect_ratio, True).split("x"))
        shade = (40 + (spec.position * 37) % 150, 60 + (spec.position * 53) % 120, 90 + (spec.position * 29) % 110)
        path = out.with_suffix(".png")
        write_solid_png(path, w, h, shade)
        return MediaResult(path, "image/png", None, 0.0, True, "dry-run")

    def render_shot(self, spec: ShotSpec, keyframe: Path, out: Path) -> MediaResult:
        warnings = []
        if spec.motion_mode == "cloud_video_model":
            warnings.append("dry-run: cloud video model was NOT called; substituted with local Ken Burns")
        if not self.ffmpeg:
            path = out.with_suffix(".txt")
            path.write_text(f"placeholder clip {spec.shot_id} {spec.render_ms}ms (ffmpeg not found)\n", encoding="utf-8")
            return MediaResult(path, "text/plain", spec.render_ms, 0.0, True, "dry-run", warnings + ["ffmpeg not found: placeholder file only"])
        adapter = _ken_burns(self.ffmpeg)
        path = out.with_suffix(".mp4")
        res = adapter.generate_video(prompt=spec.visual_prompt, output_path=str(path), first_frame=str(keyframe), duration_sec=spec.render_ms / 1000,
                                     camera_motion=spec.camera_motion, target_resolution=resolution_for(spec.aspect_ratio, True), fps=15)
        if not res.get("success"):
            raise EngineError(f"Ken Burns 渲染失败: {str(res.get('error'))[:500]}", retryable=False, code="ken_burns_failed")
        return MediaResult(path, "video/mp4", spec.render_ms, 0.0, True, "dry-run:local_kenburns", warnings)

    def compose(self, clips: List[MediaResult], audios: List[Optional[MediaResult]], aspect_ratio: str, bgm: Optional[str], work: Path, out: Path) -> MediaResult:
        total = sum((c.duration_ms or 0) for c in clips)
        if not self.ffmpeg or any(c.mime_type != "video/mp4" for c in clips):
            path = out.with_suffix(".txt")
            path.write_text(f"placeholder final video, {len(clips)} shots, {total}ms\n", encoding="utf-8")
            return MediaResult(path, "text/plain", total, 0.0, True, "dry-run", ["ffmpeg not found: placeholder final video"])
        report = _compose_with_factory(self.ffmpeg, clips, audios, work, resolution_for(aspect_ratio, True), None)
        path = out.with_suffix(".mp4")
        shutil.copyfile(report["output_video"], path)
        return MediaResult(path, "video/mp4", total, 0.0, True, "dry-run:composer")


class VideoFactoryEngine:
    """Real engine. Cloud shots call DashScope Wanx (PAID) — only reachable for approved jobs (DB Mandate)."""

    name = "video-factory"
    dry_run = False

    def __init__(self, ffmpeg: Optional[str] = None, cloud_model: str = "wan2.7-t2v-2026-06-12"):
        self.ffmpeg = ffmpeg or shutil.which("ffmpeg") or "ffmpeg"
        self.cloud_model = cloud_model

    def synthesize(self, text: str, voice: str, out: Path) -> MediaResult:
        import asyncio

        _import_video_factory()
        try:
            from audio_engine import AudioEngine  # type: ignore  # noqa: E402
        except ImportError as e:  # pragma: no cover - depends on optional deps
            raise EngineError(f"video-factory 依赖缺失: {e}", code="engine_unavailable") from e
        path = out.with_suffix(".mp3")
        try:
            seconds = asyncio.run(AudioEngine(default_voice=voice).generate_single_shot_audio(text=text, output_path=str(path), voice=voice))
        except Exception as e:  # edge-tts is free: safe to retry
            raise EngineError(f"TTS 失败: {e}", retryable=True, code="tts_failed") from e
        return MediaResult(path, "audio/mpeg", int(round(seconds * 1000)), 0.0, False, "edge_tts")

    def keyframe(self, spec: ShotSpec, out: Path) -> MediaResult:
        raise EngineError("镜头缺少关键帧资产；关键帧生图属于付费能力，尚未接入自动生成，请先在资产库上传关键帧。", code="missing_keyframe")

    def render_shot(self, spec: ShotSpec, keyframe: Optional[Path], out: Path) -> MediaResult:
        path = out.with_suffix(".mp4")
        _import_video_factory()
        if spec.motion_mode == "cloud_video_model":
            from adapters.wanx import WanxAdapter  # type: ignore  # noqa: E402

            try:
                res = WanxAdapter().generate_video(prompt=spec.visual_prompt, output_path=str(path), first_frame=str(keyframe) if keyframe else None,
                                                  duration_sec=spec.cloud_clip_seconds or 5, aspect_ratio=spec.aspect_ratio, model=self.cloud_model)
            except Exception as e:
                raise EngineError(f"云端视频模型调用异常: {e}", billable=True, code="cloud_video_failed") from e
            if not res.get("success"):
                raise EngineError(f"云端视频模型失败: {str(res.get('error'))[:500]}", billable=True, code="cloud_video_failed")
            return MediaResult(path, "video/mp4", spec.render_ms, float(res.get("cost", 0.0)) * 100, False, "wanx")
        if keyframe is None:
            return self.keyframe(spec, out)
        res = _ken_burns(self.ffmpeg).generate_video(prompt=spec.visual_prompt, output_path=str(path), first_frame=str(keyframe), duration_sec=spec.render_ms / 1000,
                                                    camera_motion=spec.camera_motion, target_resolution=resolution_for(spec.aspect_ratio, False))
        if not res.get("success"):
            raise EngineError(f"Ken Burns 渲染失败: {str(res.get('error'))[:500]}", code="ken_burns_failed")
        return MediaResult(path, "video/mp4", spec.render_ms, 0.0, False, "local_kenburns")

    def compose(self, clips: List[MediaResult], audios: List[Optional[MediaResult]], aspect_ratio: str, bgm: Optional[str], work: Path, out: Path) -> MediaResult:
        report = _compose_with_factory(self.ffmpeg, clips, audios, work, resolution_for(aspect_ratio, False), bgm)
        path = out.with_suffix(".mp4")
        shutil.copyfile(report["output_video"], path)
        return MediaResult(path, "video/mp4", sum((c.duration_ms or 0) for c in clips), 0.0, False, "composer")


def build_engine(name: str):
    if name == "dry-run":
        return DryRunEngine()
    if name == "dry-run-no-ffmpeg":
        return DryRunEngine(use_ffmpeg=False)
    if name == "video-factory":
        return VideoFactoryEngine()
    raise ValueError(f"unknown engine {name}")
