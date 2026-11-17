#!/usr/bin/env python3
"""Signal to Story video worker: claims video_* agent_jobs and runs them through video-factory.

  python3 workers/video/worker.py --dry-run                 # REST backend (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), dry-run engine
  python3 workers/video/worker.py --engine video-factory    # real engine (edge-tts, Ken Burns, Wanx = PAID, only for approved jobs)
  python3 workers/video/worker.py --backend stdio --dry-run --once   # driven by `npm run demo:video` (PGlite bridge)

SIGINT/SIGTERM: stop claiming; the in-flight job finishes its current step boundary or its lease expires.
Logs are JSON lines on stderr (stdout is reserved for the stdio bridge).
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from video_worker.backend import RestBackend, StdioBackend  # noqa: E402
from video_worker.contract import RENDER_JOB_TYPES  # noqa: E402
from video_worker.engines import build_engine  # noqa: E402
from video_worker.processor import process_next_job  # noqa: E402


def log(msg: str, data: dict) -> None:
    sys.stderr.write(json.dumps({"level": "info", "msg": msg, **data}, ensure_ascii=False, default=str) + "\n")
    sys.stderr.flush()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backend", choices=["rest", "stdio"], default="rest")
    parser.add_argument("--engine", choices=["dry-run", "dry-run-no-ffmpeg", "video-factory"], default=None)
    parser.add_argument("--dry-run", action="store_true", help="never call paid providers (same as --engine dry-run)")
    parser.add_argument("--once", action="store_true", help="drain the queue then exit")
    parser.add_argument("--max-jobs", type=int, default=0)
    args = parser.parse_args(argv)

    engine_name = args.engine or "dry-run"
    if args.dry_run and engine_name == "video-factory":
        parser.error("--dry-run conflicts with --engine video-factory")
    engine = build_engine(engine_name)

    env = os.environ
    if args.backend == "stdio":
        backend = StdioBackend(stdin=sys.stdin, stdout=sys.stdout)
        sys.stdout = sys.stderr  # video-factory prints progress; keep the bridge channel clean
    else:
        url, key = env.get("SUPABASE_URL", "").strip(), env.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not url or not key:
            parser.error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see workers/video/.env.example)")
        backend = RestBackend(url, key)
    worker_id = env.get("SENSE_VIDEO_WORKER_ID") or f"video-{socket.gethostname()}-{os.getpid()}"
    job_types = [t.strip() for t in env.get("SENSE_VIDEO_JOB_TYPES", ",".join(RENDER_JOB_TYPES)).split(",") if t.strip()]
    lease = int(env.get("SENSE_VIDEO_LEASE_SECONDS", "300"))
    poll = float(env.get("SENSE_VIDEO_POLL_SECONDS", "5"))
    work_root = Path(env["SENSE_VIDEO_WORK_DIR"]) if env.get("SENSE_VIDEO_WORK_DIR") else None
    bucket = env.get("SENSE_VIDEO_BUCKET", "video-studio")

    stopping = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopping.set())

    log("video worker started", {"worker_id": worker_id, "engine": engine.name, "dry_run": engine.dry_run, "job_types": job_types, "backend": args.backend})
    done = 0
    while not stopping.is_set():
        try:
            result = process_next_job(backend, engine, worker_id, job_types, lease, work_root, bucket, log)
        except Exception as e:  # poll failure; back off
            log("poll failed", {"error": str(e)})
            if args.once:
                return 1
            stopping.wait(min(poll * 2, 60))
            continue
        if result is None:
            if args.once:
                break
            stopping.wait(poll)
            continue
        done += 1
        log("job processed", {k: v for k, v in result.items() if k != "result"})
        if args.max_jobs and done >= args.max_jobs:
            break
    log("video worker stopped", {"worker_id": worker_id, "processed": done})
    return 0


if __name__ == "__main__":
    sys.exit(main())
