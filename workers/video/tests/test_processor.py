import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from video_worker.backend import RestBackend, StdioBackend
from video_worker.engines import DryRunEngine, EngineError
from video_worker.processor import process_next_job

from tests.fakes import MemoryBackend


class BillableFailEngine(DryRunEngine):
    name = "failing"

    def render_shot(self, spec, keyframe, out):
        raise EngineError("provider timeout after submit", billable=True, code="cloud_video_failed")


class ProcessorTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.db = MemoryBackend(self.dir / "objects")
        self.engine = DryRunEngine(use_ffmpeg=False)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_one(self, engine=None):
        return process_next_job(self.db, engine or self.engine, "w1", lease_seconds=60, work_root=self.dir, heartbeat_interval=30)

    def test_shot_render_writes_assets_state_and_ledger(self):
        pid = self.db.add_plan(2)
        shot = self.db.plan_shots(pid)[0]
        self.db.shots[shot["id"]]["render_status"] = "queued"
        jid = self.db.add_job("video_shot_render", pid, shot["id"])
        out = self.run_one()
        self.assertEqual(out["status"], "succeeded")
        s = self.db.shots[shot["id"]]
        self.assertEqual(s["render_status"], "rendered")
        self.assertIsNotNone(s["audio_asset_id"])
        self.assertIsNotNone(s["video_asset_id"])
        self.assertGreater(s["actual_duration_ms"], 0)
        cats = sorted(a["category"] for a in self.db.assets.values())
        self.assertEqual(cats, ["keyframe", "shot_clip", "voiceover"])
        self.assertTrue(all(a["asset_type"] == "video_studio" and a["created_by"] for a in self.db.assets.values()))
        self.assertTrue(all(a["cloud_url"].startswith("supabase://video-studio/") for a in self.db.assets.values()))
        self.assertEqual(sorted(e["kind"] for e in self.db.ledger), ["shot_render", "tts"])
        result = self.db.jobs[jid]["result"]
        self.assertEqual(result["shots"][0]["render_ms"], s["actual_duration_ms"] + 300)  # Audio-First
        self.assertTrue(result["dry_run"])

    def test_compose_renders_missing_shots_and_sets_plan(self):
        pid = self.db.add_plan(3)
        self.db.add_job("video_compose", pid)
        out = self.run_one()
        self.assertEqual(out["status"], "succeeded")
        plan = self.db.plans[pid]
        self.assertEqual(plan["status"], "rendered")
        self.assertIsNotNone(plan["composed_video_asset_id"])
        self.assertTrue(all(s["render_status"] == "rendered" for s in self.db.plan_shots(pid)))
        self.assertEqual(plan["final_duration_ms"], sum(r["render_ms"] for r in out["result"]["shots"]))

    def test_stale_revision_fails_without_rendering(self):
        pid = self.db.add_plan(1, revision=2)
        shot = self.db.plan_shots(pid)[0]
        self.db.add_job("video_shot_render", pid, shot["id"], revision=1)
        out = self.run_one()
        self.assertEqual(out["error_code"], "stale_target")
        self.assertEqual(self.db.assets, {})

    def test_billable_failure_is_not_retried(self):
        pid = self.db.add_plan(1, motion="cloud_video_model")
        shot = self.db.plan_shots(pid)[0]
        self.db.add_job("video_shot_render", pid, shot["id"])
        out = self.run_one(BillableFailEngine(use_ffmpeg=False))
        self.assertEqual(self.db.calls[-1], ("fail", False, "cloud_video_failed"))
        self.assertTrue(out["billable"])

    def test_invalid_contract_and_cancel(self):
        pid = self.db.add_plan(1)
        jid = self.db.add_job("video_shot_render", pid, None)
        self.assertEqual(self.run_one()["error_code"], "invalid_contract")
        self.assertEqual(self.db.jobs[jid]["status"], "failed")
        shot = self.db.plan_shots(pid)[0]
        self.db.add_job("video_tts_preview", pid, shot["id"])
        self.db.cancel = True
        self.assertEqual(self.run_one()["status"], "cancelled")

    def test_stale_lease_epoch_stops_without_writes(self):
        pid = self.db.add_plan(1)
        shot = self.db.plan_shots(pid)[0]
        jid = self.db.add_job("video_tts_preview", pid, shot["id"])
        original = self.db.claim

        def claim_then_reclaimed(job_types, lease_seconds):
            row = original(job_types, lease_seconds)
            self.db.jobs[jid]["lease_epoch"] += 1  # the lease expired and another node claimed the job
            return row

        self.db.claim = claim_then_reclaimed
        self.assertEqual(self.run_one()["status"], "lease_lost")
        self.assertEqual(self.db.calls, [])

    def test_tts_preview_only_touches_audio(self):
        pid = self.db.add_plan(1)
        shot = self.db.plan_shots(pid)[0]
        self.db.add_job("video_tts_preview", pid, shot["id"])
        self.assertEqual(self.run_one()["status"], "succeeded")
        s = self.db.shots[shot["id"]]
        self.assertEqual(s["render_status"], "pending")
        self.assertIsNotNone(s["audio_asset_id"])
        self.assertIsNone(s["video_asset_id"])

    def test_empty_queue(self):
        self.assertIsNone(self.run_one())


class FakeResponse:
    def __init__(self, body, ctype="application/json"):
        self.body = body
        self.headers = {"Content-Type": ctype}

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TransportTest(unittest.TestCase):
    def test_rest_backend_request_shapes(self):
        seen = []

        def opener(req, timeout):
            seen.append(req)
            if "/rpc/claim_agent_job" in req.full_url:
                return FakeResponse(json.dumps([{"id": "j1"}]).encode())
            if req.full_url.endswith("/rest/v1/assets?select=id"):
                return FakeResponse(json.dumps([{"id": 7}]).encode())
            return FakeResponse(b"")

        rest = RestBackend("https://example.supabase.co/", "service-key", opener=opener)
        self.assertEqual(rest.claim(["video_compose"], 60), {"id": "j1"})
        self.assertEqual(rest.insert_asset({"name": "a"}), 7)
        rest.update_shot("s 1", {"render_status": "rendering"})
        claim, asset, patch = seen
        self.assertEqual(claim.get_method(), "POST")
        self.assertEqual(json.loads(claim.data), {"p_job_types": ["video_compose"], "p_lease_seconds": 60})
        self.assertEqual(claim.headers["Authorization"], "Bearer service-key")
        self.assertEqual(asset.headers["Prefer"], "return=representation")
        self.assertEqual(patch.get_method(), "PATCH")
        self.assertIn("id=eq.s%201", patch.full_url)

    def test_stdio_backend_round_trip(self):
        stdout = io.StringIO()
        stdin = io.StringIO(json.dumps({"id": 1, "ok": True, "result": {"ok": True, "cancel_requested": False}}) + "\n")
        bridge = StdioBackend(stdin=stdin, stdout=stdout)
        self.assertEqual(bridge.heartbeat("j", 3, 60), {"ok": True, "cancel_requested": False})
        self.assertEqual(json.loads(stdout.getvalue()), {"id": 1, "op": "heartbeat", "args": {"job_id": "j", "lease_epoch": 3, "lease_seconds": 60}})


if __name__ == "__main__":
    unittest.main()
