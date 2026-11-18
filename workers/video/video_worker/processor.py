"""Claim one video_* job, run it through an engine, write assets / shot state / ledger, complete or fail."""

from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .backend import Backend, BackendError
from .contract import SCHEMA_VERSION, RENDER_JOB_TYPES, ContractError, align_shot_duration, job_from_row, validate_job, validate_result
from .engines import EngineError, MediaResult, ShotSpec

DEFAULT_BUCKET = "video-studio"
MEDIA_TYPES = {"audio": "audio", "video": "video", "image": "image"}


class StaleTargetError(RuntimeError):
    pass


class LeaseLost(RuntimeError):
    pass


class Cancelled(RuntimeError):
    pass


def _log(logger: Optional[Callable[[str, Dict[str, Any]], None]], msg: str, **data: Any) -> None:
    if logger:
        logger(msg, data)


class JobRun:
    def __init__(self, backend: Backend, engine, job: Dict[str, Any], worker_id: str, lease_seconds: int, work_dir: Path, bucket: str, logger=None):
        self.backend = backend
        self.engine = engine
        self.job = job
        self.worker_id = worker_id
        self.epoch = int(job["lease_epoch"])
        self.target = job["payload"]["target"]
        self.lease = lease_seconds
        self.work = work_dir
        self.bucket = bucket
        self.logger = logger
        self.assets: List[Dict[str, Any]] = []
        self.shot_results: List[Dict[str, Any]] = []
        self.warnings: List[str] = []
        self.cost = 0.0
        self.plan: Dict[str, Any] = {}
        self.audio_cache: Dict[str, Optional[MediaResult]] = {}

    # ---- helpers
    def check_lease(self) -> None:
        beat = self.backend.heartbeat(self.job["id"], self.epoch, self.lease)
        if not beat.get("ok"):
            raise LeaseLost()
        if beat.get("cancel_requested"):
            raise Cancelled()

    def object_path(self, name: str) -> str:
        return f"{self.job['organization_id']}/{self.plan['id']}/{self.job['id']}/{name}"

    def store(self, media: MediaResult, category: str, shot_id: Optional[str], name: str) -> int:
        path = self.object_path(media.path.name)
        self.backend.upload(self.bucket, path, str(media.path), media.mime_type)
        data = media.path.read_bytes()
        media_type = MEDIA_TYPES.get(media.mime_type.split("/")[0], "other")
        asset_id = self.backend.insert_asset({
            "organization_id": self.job["organization_id"], "asset_type": "video_studio", "category": category, "media_type": media_type,
            "name": name[:120], "cloud_url": f"supabase://{self.bucket}/{path}",
            "description": "视频工坊生成物" + ("（dry-run 占位）" if media.placeholder else ""),
            "metadata": {"plan_id": self.plan["id"], "plan_revision": self.plan["revision"], "shot_id": shot_id, "agent_job_id": self.job["id"],
                         "engine": self.engine.name, "provider": media.provider, "placeholder": media.placeholder, "mime_type": media.mime_type,
                         "duration_ms": media.duration_ms, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()},
            "created_by": self.job["created_by"],
        })
        self.assets.append({"category": category, "asset_id": asset_id, "shot_id": shot_id, "storage_path": path, "mime_type": media.mime_type,
                            "duration_ms": media.duration_ms, "placeholder": media.placeholder})
        self.warnings.extend(w for w in media.warnings if w not in self.warnings)
        return asset_id

    def ledger(self, kind: str, shot_id: Optional[str], media: MediaResult, estimated: float) -> None:
        self.cost += media.cost_cents
        self.backend.insert_cost_entry({
            "organization_id": self.job["organization_id"], "plan_id": self.plan["id"], "shot_id": shot_id, "agent_job_id": self.job["id"], "kind": kind,
            "provider": media.provider[:64], "estimated_cents": estimated, "actual_cents": media.cost_cents,
            "metadata": {"engine": self.engine.name, "dry_run": self.engine.dry_run, "placeholder": media.placeholder},
        })

    def load_plan(self) -> List[Dict[str, Any]]:
        plan = self.backend.get_plan(self.target["id"])
        if not plan or plan.get("organization_id") != self.job["organization_id"]:
            raise StaleTargetError("分镜计划不存在")
        if int(plan["revision"]) != int(self.target["revision"]):
            raise StaleTargetError(f"分镜计划已修改（任务 r{self.target['revision']}，当前 r{plan['revision']}）")
        self.plan = plan
        return self.backend.list_shots(plan["id"])

    def spec(self, shot: Dict[str, Any], narration_ms: Optional[int]) -> ShotSpec:
        a = align_shot_duration(narration_ms, int(shot["target_duration_ms"]), shot["motion_mode"])
        return ShotSpec(shot_id=shot["id"], position=int(shot["position"]), motion_mode=shot["motion_mode"], camera_motion=shot["camera_motion"],
                        visual_prompt=shot.get("visual_prompt") or "", narration=shot.get("narration") or "", voice=shot.get("voice") or self.plan["default_voice"],
                        render_ms=a.renderMs, cloud_clip_seconds=a.cloudClipSeconds, aspect_ratio=self.plan["aspect_ratio"])

    def recheck_revision(self) -> None:
        again = self.backend.get_plan(self.plan["id"])
        if not again or int(again["revision"]) != int(self.target["revision"]):
            raise StaleTargetError("渲染开始前分镜被修改")

    def ensure_audio(self, shot: Dict[str, Any]) -> Optional[MediaResult]:
        if shot["id"] in self.audio_cache:
            return self.audio_cache[shot["id"]]
        media = self._ensure_audio(shot)
        self.audio_cache[shot["id"]] = media
        return media

    def _ensure_audio(self, shot: Dict[str, Any]) -> Optional[MediaResult]:
        text = (shot.get("narration") or "").strip()
        if not text:
            return None
        voice = shot.get("voice") or self.plan["default_voice"]
        base = self.work / f"voice_{int(shot['position']):02d}"
        if shot.get("audio_asset_id"):
            asset = self.backend.get_asset(int(shot["audio_asset_id"]))
            loc = (asset or {}).get("cloud_url") or ""
            if loc.startswith("supabase://"):
                bucket, _, path = loc[len("supabase://"):].partition("/")
                dest = base.with_suffix(Path(path).suffix)
                self.backend.download(bucket, path, str(dest))
                duration = shot.get("actual_duration_ms") or (asset or {}).get("metadata", {}).get("duration_ms")
                return MediaResult(dest, (asset or {}).get("metadata", {}).get("mime_type", "audio/wav"), duration, 0.0, bool((asset or {}).get("metadata", {}).get("placeholder")), "stored")
        estimated = 0.0  # edge_tts is free; cloud TTS pricing is estimated server-side
        self.check_lease()
        media = self.engine.synthesize(text, voice, base)
        asset_id = self.store(media, "voiceover", shot["id"], f"配音 镜{shot['position']}")
        self.ledger("tts", shot["id"], media, estimated)
        self.backend.update_shot(shot["id"], {"audio_asset_id": asset_id, "actual_duration_ms": media.duration_ms})
        shot["audio_asset_id"], shot["actual_duration_ms"] = asset_id, media.duration_ms
        return media

    def keyframe_for(self, shot: Dict[str, Any], spec: ShotSpec) -> Optional[Path]:
        if shot.get("keyframe_asset_id"):
            asset = self.backend.get_asset(int(shot["keyframe_asset_id"]))
            loc = (asset or {}).get("cloud_url") or ""
            if loc.startswith("supabase://"):
                bucket, _, path = loc[len("supabase://"):].partition("/")
                dest = self.work / f"keyframe_{spec.position:02d}{Path(path).suffix or '.png'}"
                self.backend.download(bucket, path, str(dest))
                return dest
        if spec.motion_mode == "cloud_video_model" and not self.engine.dry_run:
            return None  # text-to-video without a first frame
        media = self.engine.keyframe(spec, self.work / f"keyframe_{spec.position:02d}")
        # Not linked as keyframe_asset_id: that is human-chosen content (would bump the plan revision).
        self.store(media, "keyframe", shot["id"], f"关键帧 镜{shot['position']}（自动占位）")
        return media.path

    def render(self, shot: Dict[str, Any], from_status: str) -> MediaResult:
        if from_status in ("pending", "failed", "rendered"):
            self.backend.update_shot(shot["id"], {"render_status": "queued", "error": None})
        self.backend.update_shot(shot["id"], {"render_status": "rendering", "error": None})
        shot["render_status"] = "rendering"
        self.recheck_revision()
        audio = self.ensure_audio(shot)
        spec = self.spec(shot, audio.duration_ms if audio else None)
        keyframe = self.keyframe_for(shot, spec)
        self.check_lease()
        estimated = float(shot.get("estimated_cost_cents") or 0)
        clip = self.engine.render_shot(spec, keyframe, self.work / f"shot_{spec.position:02d}")
        asset_id = self.store(clip, "shot_clip", shot["id"], f"镜头 {shot['position']}")
        self.ledger("shot_render", shot["id"], clip, estimated if shot["motion_mode"] == "cloud_video_model" else 0.0)
        self.backend.update_shot(shot["id"], {"video_asset_id": asset_id, "render_status": "rendered", "error": None})
        shot["video_asset_id"], shot["render_status"] = asset_id, "rendered"
        self.shot_results.append({"shot_id": shot["id"], "render_ms": spec.render_ms, "narration_ms": audio.duration_ms if audio else None, "status": "rendered"})
        clip.duration_ms = spec.render_ms
        return clip

    def stored_clip(self, shot: Dict[str, Any]) -> Optional[MediaResult]:
        asset = self.backend.get_asset(int(shot["video_asset_id"])) if shot.get("video_asset_id") else None
        loc = (asset or {}).get("cloud_url") or ""
        if not loc.startswith("supabase://"):
            return None
        bucket, _, path = loc[len("supabase://"):].partition("/")
        dest = self.work / f"stored_shot_{int(shot['position']):02d}{Path(path).suffix}"
        self.backend.download(bucket, path, str(dest))
        meta = (asset or {}).get("metadata") or {}
        return MediaResult(dest, meta.get("mime_type", "video/mp4"), meta.get("duration_ms"), 0.0, bool(meta.get("placeholder")), "stored")

    # ---- job types
    def run(self) -> Dict[str, Any]:
        shots = self.load_plan()
        job_type = self.job["kind"]
        shot_id = self.job["payload"].get("shot_id")
        final_ms = None
        if job_type == "video_tts_preview":
            shot = next((s for s in shots if s["id"] == shot_id), None)
            if shot is None:
                raise StaleTargetError("镜头不存在")
            shot["audio_asset_id"] = None  # always re-synthesize on explicit preview
            media = self.ensure_audio(shot)
            self.shot_results.append({"shot_id": shot["id"], "render_ms": self.spec(shot, media.duration_ms if media else None).render_ms,
                                      "narration_ms": media.duration_ms if media else None, "status": shot["render_status"]})
        elif job_type == "video_shot_render":
            shot = next((s for s in shots if s["id"] == shot_id), None)
            if shot is None:
                raise StaleTargetError("镜头不存在")
            self.render(shot, shot["render_status"])
        elif job_type == "video_compose":
            self.backend.update_plan(self.plan["id"], {"status": "rendering", "error": None})
            self.recheck_revision()
            clips: List[MediaResult] = []
            audios: List[Optional[MediaResult]] = []
            for shot in shots:
                self.check_lease()
                existing = self.stored_clip(shot) if shot.get("video_asset_id") and shot["render_status"] == "rendered" else None
                if existing:
                    existing.duration_ms = self.spec(shot, shot.get("actual_duration_ms")).render_ms
                    clips.append(existing)
                    audios.append(self.ensure_audio(shot))
                    self.shot_results.append({"shot_id": shot["id"], "render_ms": existing.duration_ms, "narration_ms": shot.get("actual_duration_ms"), "status": "rendered"})
                else:
                    clips.append(self.render(shot, shot["render_status"]))
                    audios.append(self.ensure_audio(shot))
            self.check_lease()
            final = self.engine.compose(clips, audios, self.plan["aspect_ratio"], self.plan.get("bgm_track"), self.work, self.work / "final_video")
            asset_id = self.store(final, "final_video", None, f"成片 {self.plan['title']} r{self.plan['revision']}")
            self.ledger("compose", None, final, 0.0)
            final_ms = final.duration_ms
            self.backend.update_plan(self.plan["id"], {"status": "rendered", "composed_video_asset_id": asset_id, "final_duration_ms": final_ms, "error": None})
        else:
            raise ContractError(f"unsupported job type {job_type}")
        if self.engine.dry_run and "dry-run: no paid provider was called" not in self.warnings:
            self.warnings.append("dry-run: no paid provider was called")
        return validate_result({
            "schema_version": SCHEMA_VERSION, "kind": job_type, "engine": self.engine.name, "dry_run": self.engine.dry_run,
            "plan_id": self.plan["id"], "plan_revision": int(self.plan["revision"]), "assets": self.assets, "cost_cents": round(self.cost, 4),
            "shots": self.shot_results, "final_duration_ms": final_ms, "warnings": self.warnings,
        })


def process_next_job(backend: Backend, engine, worker_id: str, job_types: Optional[List[str]] = None, lease_seconds: int = 300,
                     work_root: Optional[Path] = None, bucket: str = DEFAULT_BUCKET, logger=None, heartbeat_interval: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Claim and process at most one job. Returns a summary dict, or None when the queue is empty."""
    row = backend.claim(list(job_types or RENDER_JOB_TYPES), lease_seconds)
    if not row:
        return None
    job_id = row["id"]
    epoch = int(row.get("lease_epoch") or 0)  # every write below carries the lease generation claim returned
    _log(logger, "job claimed", job_id=job_id, kind=row.get("kind"), attempt=row.get("attempts"), lease_epoch=epoch, worker_id=worker_id)
    stop = threading.Event()

    def beat():
        while not stop.wait(heartbeat_interval or max(5, lease_seconds // 3)):
            try:
                backend.heartbeat(job_id, epoch, lease_seconds)
            except Exception as e:  # pragma: no cover - logged only
                _log(logger, "heartbeat failed", job_id=job_id, error=str(e))

    thread = threading.Thread(target=beat, daemon=True)
    thread.start()
    work = Path(tempfile.mkdtemp(prefix="sense-video-", dir=str(work_root) if work_root else None))
    try:
        try:
            job = validate_job(job_from_row(row))
        except ContractError as e:
            backend.fail(job_id, epoch, f"任务契约无效: {e}", False, 0, "invalid_contract")
            return {"job_id": job_id, "status": "failed", "error_code": "invalid_contract", "error": str(e)}
        if not job.get("created_by"):
            backend.fail(job_id, epoch, "任务缺少发起人，无法登记资产", False, 0, "invalid_contract")
            return {"job_id": job_id, "status": "failed", "error_code": "invalid_contract"}
        run = JobRun(backend, engine, job, worker_id, lease_seconds, work, bucket, logger)
        try:
            result = run.run()
            run.check_lease()
            backend.complete(job_id, epoch, "succeeded", result, None, None)
            _log(logger, "job succeeded", job_id=job_id, assets=len(result["assets"]), cost_cents=result["cost_cents"])
            return {"job_id": job_id, "status": "succeeded", "result": result}
        except LeaseLost:
            _log(logger, "lease lost; stopping without writes", job_id=job_id)
            return {"job_id": job_id, "status": "lease_lost"}
        except Cancelled:
            backend.complete(job_id, epoch, "cancelled", {"assets": run.assets}, "人工取消，已在步骤边界停止", "cancelled")
            return {"job_id": job_id, "status": "cancelled"}
        except StaleTargetError as e:
            backend.complete(job_id, epoch, "failed", {"termination_reason": str(e)}, str(e), "stale_target")
            return {"job_id": job_id, "status": "failed", "error_code": "stale_target", "error": str(e)}
        except EngineError as e:
            # Paid (billable) failures are never retried automatically.
            backend.fail(job_id, epoch, str(e), e.retryable, 30, e.code)
            return {"job_id": job_id, "status": "failed" if not e.retryable else "retry", "error_code": e.code, "error": str(e), "billable": e.billable}
        except (BackendError, OSError) as e:
            billed = any(a.get("category") == "shot_clip" for a in run.assets) and run.cost > 0
            try:
                backend.fail(job_id, epoch, f"worker error: {e}"[:1000], not billed, 30, "worker_error")
            except Exception:
                pass
            return {"job_id": job_id, "status": "retry" if not billed else "failed", "error_code": "worker_error", "error": str(e)}
    finally:
        stop.set()
        thread.join(timeout=2)
        shutil.rmtree(work, ignore_errors=True)


def summarize(result: Optional[Dict[str, Any]]) -> str:
    return json.dumps(result, ensure_ascii=False, default=str)
