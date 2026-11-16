"""Job contract shared with src/contracts/video-studio.ts.

The JSON Schema in ../contract/video-job.schema.json is generated from the zod contract
(`npm run video:contract`); fixtures.json holds vectors both test suites check.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

CONTRACT_DIR = Path(__file__).resolve().parent.parent / "contract"
SCHEMA_PATH = CONTRACT_DIR / "video-job.schema.json"
FIXTURES_PATH = CONTRACT_DIR / "fixtures.json"

SCHEMA_VERSION = 1
RENDER_JOB_TYPES = ("video_tts_preview", "video_shot_render", "video_compose")
MOTION_MODES = ("local_ken_burns", "cloud_video_model")

# Mirrors VIDEO_COST_RATES / private.video_cost_rate() (cents of CNY).
CLOUD_TTS_PER_100_CHARS = 2
CLOUD_VIDEO_PER_5S = 35
FREE_THRESHOLD_CENTS = 10
PADDING_MS = 300

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


class ContractError(ValueError):
    pass


def load_schema() -> Dict[str, Any]:
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _validator(defn: str):
    try:
        import jsonschema  # type: ignore
    except ImportError:  # optional dependency
        return None
    schema = load_schema()
    sub = dict(schema["$defs"][defn])
    sub["$defs"] = schema["$defs"]
    return jsonschema.Draft202012Validator(sub)


def _fallback_job_checks(job: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    for key in ("id", "organization_id", "target_id"):
        if not isinstance(job.get(key), str) or not _UUID.match(job[key]):
            errors.append(f"{key}: invalid uuid")
    if job.get("job_type") not in RENDER_JOB_TYPES:
        errors.append("job_type: unsupported")
    if job.get("target_type") != "video_plan":
        errors.append("target_type: must be video_plan")
    if not isinstance(job.get("target_revision"), int) or job["target_revision"] < 1:
        errors.append("target_revision: invalid")
    payload = job.get("payload")
    if not isinstance(payload, dict) or payload.get("schema_version") != SCHEMA_VERSION:
        errors.append("payload.schema_version: must be 1")
    return errors


def validate_job(job: Dict[str, Any]) -> Dict[str, Any]:
    """Raise ContractError unless `job` (a claimed agent_jobs row subset) satisfies the contract."""
    validator = _validator("job")
    if validator is not None:
        errors = [f"{'/'.join(str(p) for p in e.path) or '(root)'}: {e.message}" for e in validator.iter_errors(job)]
    else:
        errors = _fallback_job_checks(job)
    if errors:
        raise ContractError("; ".join(errors[:6]))
    payload = job["payload"]
    if job["job_type"] != "video_compose" and not payload.get("shot_id"):
        raise ContractError("payload.shot_id: required for shot jobs")
    if payload.get("plan_id") != job["target_id"]:
        raise ContractError("payload.plan_id must equal target_id")
    return job


def validate_result(result: Dict[str, Any]) -> Dict[str, Any]:
    validator = _validator("result")
    if validator is not None:
        errors = [e.message for e in validator.iter_errors(result)]
        if errors:
            raise ContractError("; ".join(errors[:6]))
    elif result.get("schema_version") != SCHEMA_VERSION:
        raise ContractError("result.schema_version must be 1")
    return result


def job_from_row(row: Dict[str, Any]) -> Dict[str, Any]:
    keys = ("id", "organization_id", "job_type", "target_type", "target_id", "target_revision", "approval_request_id", "created_by", "payload")
    return {k: row.get(k) for k in keys}


@dataclass(frozen=True)
class Alignment:
    renderMs: int
    cloudClipSeconds: Optional[int]
    holdMs: int
    driftMs: int
    source: str

    def as_dict(self) -> Dict[str, Any]:
        return {"renderMs": self.renderMs, "cloudClipSeconds": self.cloudClipSeconds, "holdMs": self.holdMs, "driftMs": self.driftMs, "source": self.source}


def _round(x: float) -> int:
    # JS Math.round semantics for the values we use (non-negative, .5 rounds up)
    return int(math.floor(x + 0.5))


def cloud_clip_seconds(target_ms: int, actual_ms: Optional[int]) -> int:
    billed = actual_ms + PADDING_MS if actual_ms is not None else target_ms
    return 5 if billed <= 5000 else 10


def align_shot_duration(narration_ms: Optional[int], target_ms: int, motion_mode: str, padding_ms: int = PADDING_MS, min_ms: int = 1000, max_ms: int = 60000) -> Alignment:
    """Audio-First: picture duration = real narration duration + tail padding (mirrors alignShotDuration)."""
    has_narration = narration_ms is not None and narration_ms > 0
    raw = _round(narration_ms + padding_ms) if has_narration else _round(target_ms)
    render_ms = min(max_ms, max(min_ms, raw))
    clip = cloud_clip_seconds(target_ms, narration_ms if has_narration else None) if motion_mode == "cloud_video_model" else None
    hold = max(0, render_ms - clip * 1000) if clip else 0
    return Alignment(render_ms, clip, hold, render_ms - _round(target_ms), "narration" if has_narration else "target")


def estimate_shot_cost_cents(motion_mode: str, target_ms: int, actual_ms: Optional[int], narration: str, tts_provider: str, include_tts: bool = True, include_video: bool = True) -> float:
    text = (narration or "").strip()
    tts = math.ceil(len(text) / 100) * CLOUD_TTS_PER_100_CHARS if include_tts and tts_provider == "cloud_tts" and text else 0
    video = (cloud_clip_seconds(target_ms, actual_ms) // 5) * CLOUD_VIDEO_PER_5S if include_video and motion_mode == "cloud_video_model" else 0
    return tts + video
