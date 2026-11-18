"""In-memory Backend used by the processor tests (mimics the DB rules the worker relies on)."""

import shutil
import uuid
from pathlib import Path

ORG = "1f0c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f"
USER = "4d3c2b1a-0f9e-4d8c-8b7a-695f4e3d2c1b"
ALLOWED = {("pending", "queued"), ("failed", "queued"), ("rendered", "queued"), ("queued", "rendering"), ("queued", "pending"), ("queued", "failed"),
           ("rendering", "rendered"), ("rendering", "failed"), ("failed", "pending"), ("rendered", "pending")}


def new_id():
    return str(uuid.uuid4())


class MemoryBackend:
    def __init__(self, store_dir: Path):
        self.store_dir = store_dir
        self.jobs, self.plans, self.shots, self.assets, self.ledger, self.calls = {}, {}, {}, {}, [], []
        self.cancel = False
        self.lease_ok = True

    # fixtures
    def add_plan(self, n_shots=2, motion="local_ken_burns", revision=1):
        pid = new_id()
        self.plans[pid] = {"id": pid, "organization_id": ORG, "revision": revision, "title": "测试", "aspect_ratio": "9:16", "default_voice": "zh-CN-XiaoxiaoNeural",
                           "tts_provider": "edge_tts", "bgm_track": None, "status": "draft"}
        for i in range(n_shots):
            sid = new_id()
            self.shots[sid] = {"id": sid, "plan_id": pid, "position": i + 1, "motion_mode": motion if i == 0 else "local_ken_burns", "camera_motion": "zoom_in",
                               "visual_prompt": "画面", "narration": f"第{i + 1}句旁白内容", "voice": None, "target_duration_ms": 3000, "actual_duration_ms": None,
                               "keyframe_asset_id": None, "audio_asset_id": None, "video_asset_id": None, "render_status": "pending", "estimated_cost_cents": 35 if (i == 0 and motion != "local_ken_burns") else 0}
        return pid

    def add_job(self, job_type, plan_id, shot_id=None, revision=None, **over):
        jid = new_id()
        rev = revision or self.plans[plan_id]["revision"]
        row = {"id": jid, "organization_id": ORG, "kind": job_type, "lease_epoch": 0, "created_by": USER, "attempts": 1, "status": "queued",
               "payload": {"schema_version": 1, "plan_id": plan_id, "plan_revision": rev, "shot_id": shot_id,
                           "target": {"type": "video_plan", "id": plan_id, "revision": rev}, "limits": {"max_rounds": 1, "max_hops": 8, "budget_cents": 1}}}
        row.update(over)
        self.jobs[jid] = row
        return jid

    def plan_shots(self, pid):
        return sorted([s for s in self.shots.values() if s["plan_id"] == pid], key=lambda s: s["position"])

    # Backend protocol
    def claim(self, job_types, lease_seconds):
        for j in self.jobs.values():
            if j["status"] == "queued" and j["kind"] in job_types:
                j["status"] = "running"
                j["lease_epoch"] += 1
                return dict(j)
        return None

    def _check_epoch(self, job_id, lease_epoch):
        # Mirrors the database: a write from an older lease is refused.
        if self.jobs[job_id]["lease_epoch"] != lease_epoch:
            raise AssertionError(f"stale lease epoch {lease_epoch} != {self.jobs[job_id]['lease_epoch']}")

    def heartbeat(self, job_id, lease_epoch, lease_seconds):
        if self.jobs[job_id]["lease_epoch"] != lease_epoch:
            return {"ok": False, "cancel_requested": False}
        return {"ok": self.lease_ok, "cancel_requested": self.cancel}

    def complete(self, job_id, lease_epoch, status, result, error, error_code):
        self._check_epoch(job_id, lease_epoch)
        self.calls.append(("complete", status, error_code))
        self.jobs[job_id].update(status=status, result=result, error=error, error_code=error_code)

    def fail(self, job_id, lease_epoch, error, retryable, retry_delay_seconds, error_code):
        self._check_epoch(job_id, lease_epoch)
        self.calls.append(("fail", retryable, error_code))
        self.jobs[job_id].update(status="queued" if retryable else "failed", error=error, error_code=error_code)

    def get_plan(self, plan_id):
        p = self.plans.get(plan_id)
        return dict(p) if p else None

    def list_shots(self, plan_id):
        return [dict(s) for s in self.plan_shots(plan_id)]

    def get_asset(self, asset_id):
        return dict(self.assets[asset_id])

    def update_shot(self, shot_id, patch):
        s = self.shots[shot_id]
        if "render_status" in patch and patch["render_status"] != s["render_status"] and (s["render_status"], patch["render_status"]) not in ALLOWED:
            raise AssertionError(f"illegal transition {s['render_status']} -> {patch['render_status']}")
        assert set(patch) <= {"render_status", "actual_duration_ms", "audio_asset_id", "video_asset_id", "error"}, patch
        s.update(patch)

    def update_plan(self, plan_id, patch):
        assert set(patch) <= {"status", "composed_video_asset_id", "final_duration_ms", "error"}, patch
        self.plans[plan_id].update(patch)

    def insert_asset(self, row):
        aid = len(self.assets) + 1
        self.assets[aid] = {"id": aid, **row}
        return aid

    def insert_cost_entry(self, row):
        self.ledger.append(row)

    def upload(self, bucket, path, local_file, content_type):
        dest = self.store_dir / bucket / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_file, dest)

    def download(self, bucket, path, dest_file):
        Path(dest_file).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.store_dir / bucket / path, dest_file)
