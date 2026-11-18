"""Database/storage port for the video worker.

* RestBackend  — production: Supabase PostgREST + Storage over HTTPS with the service_role key (outbound only).
* StdioBackend — JSON lines over stdin/stdout; `npm run demo:video` answers the same operations against PGlite
                 as service_role, so the real worker code path runs against the real schema, triggers and grants.

Operation names and argument shapes are identical in both; see workers/video/README.md.
"""

from __future__ import annotations

import json
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol


class BackendError(RuntimeError):
    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class Backend(Protocol):
    # lease_epoch: returned by claim; the database refuses writes from an older lease (a late node).
    def claim(self, job_types: List[str], lease_seconds: int) -> Optional[Dict[str, Any]]: ...
    def heartbeat(self, job_id: str, lease_epoch: int, lease_seconds: int) -> Dict[str, Any]: ...
    def complete(self, job_id: str, lease_epoch: int, status: str, result: Dict[str, Any], error: Optional[str], error_code: Optional[str]) -> None: ...
    def fail(self, job_id: str, lease_epoch: int, error: str, retryable: bool, retry_delay_seconds: int, error_code: Optional[str]) -> None: ...
    def get_plan(self, plan_id: str) -> Optional[Dict[str, Any]]: ...
    def list_shots(self, plan_id: str) -> List[Dict[str, Any]]: ...
    def get_asset(self, asset_id: int) -> Optional[Dict[str, Any]]: ...
    def update_shot(self, shot_id: str, patch: Dict[str, Any]) -> None: ...
    def update_plan(self, plan_id: str, patch: Dict[str, Any]) -> None: ...
    def insert_asset(self, row: Dict[str, Any]) -> int: ...
    def insert_cost_entry(self, row: Dict[str, Any]) -> None: ...
    def upload(self, bucket: str, path: str, local_file: str, content_type: str) -> None: ...
    def download(self, bucket: str, path: str, dest_file: str) -> None: ...


class RestBackend:
    """Not exercised against a live Supabase in this repo (no local stack); request shapes are unit-tested with a fake opener."""

    def __init__(self, url: str, service_key: str, timeout: float = 60.0, opener=None):
        self.url = url.rstrip("/")
        self.key = service_key
        self.timeout = timeout
        self.opener = opener or urllib.request.urlopen

    def _request(self, method: str, path: str, body: Any = None, headers: Optional[Dict[str, str]] = None, raw: Optional[bytes] = None) -> Any:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        data = raw
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with self.opener(req, timeout=self.timeout) as resp:
                payload = resp.read()
                ctype = resp.headers.get("Content-Type", "") if hasattr(resp, "headers") else ""
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:500]
            raise BackendError(f"{method} {path.split('?')[0]} -> {e.code}: {detail}", e.code) from None
        except urllib.error.URLError as e:
            raise BackendError(f"{method} {path.split('?')[0]} network error: {e.reason}") from None
        if not payload:
            return None
        if "json" in ctype or payload[:1] in (b"{", b"["):
            return json.loads(payload)
        return payload

    def _rpc(self, fn: str, args: Dict[str, Any]) -> Any:
        return self._request("POST", f"/rest/v1/rpc/{fn}", args)

    @staticmethod
    def _eq(value: Any) -> str:
        return "eq." + urllib.parse.quote(str(value), safe="")

    def claim(self, job_types, lease_seconds):
        rows = self._rpc("claim_agent_job", {"p_job_types": job_types, "p_lease_seconds": lease_seconds})
        rows = rows if isinstance(rows, list) else ([rows] if rows else [])
        return rows[0] if rows else None

    def heartbeat(self, job_id, lease_epoch, lease_seconds):
        return self._rpc("heartbeat_agent_job", {"p_job_id": job_id, "p_lease_epoch": lease_epoch, "p_lease_seconds": lease_seconds}) or {"ok": False}

    def complete(self, job_id, lease_epoch, status, result, error, error_code):
        self._rpc("complete_agent_job", {"p_job_id": job_id, "p_lease_epoch": lease_epoch, "p_status": status, "p_result": result, "p_error": error, "p_error_code": error_code})

    def fail(self, job_id, lease_epoch, error, retryable, retry_delay_seconds, error_code):
        self._rpc("fail_agent_job", {"p_job_id": job_id, "p_lease_epoch": lease_epoch, "p_error": error[:4000], "p_retryable": retryable, "p_retry_delay_seconds": retry_delay_seconds, "p_error_code": error_code})

    def get_plan(self, plan_id):
        rows = self._request("GET", f"/rest/v1/video_plans?id={self._eq(plan_id)}&select=*")
        return rows[0] if rows else None

    def list_shots(self, plan_id):
        return self._request("GET", f"/rest/v1/video_shots?plan_id={self._eq(plan_id)}&select=*&order=position.asc") or []

    def get_asset(self, asset_id):
        rows = self._request("GET", f"/rest/v1/assets?id={self._eq(asset_id)}&select=id,organization_id,cloud_url,media_type,metadata")
        return rows[0] if rows else None

    def update_shot(self, shot_id, patch):
        self._request("PATCH", f"/rest/v1/video_shots?id={self._eq(shot_id)}", patch, {"Prefer": "return=minimal"})

    def update_plan(self, plan_id, patch):
        self._request("PATCH", f"/rest/v1/video_plans?id={self._eq(plan_id)}", patch, {"Prefer": "return=minimal"})

    def insert_asset(self, row):
        rows = self._request("POST", "/rest/v1/assets?select=id", row, {"Prefer": "return=representation"})
        return int(rows[0]["id"])

    def insert_cost_entry(self, row):
        try:
            self._request("POST", "/rest/v1/video_cost_entries", row, {"Prefer": "return=minimal"})
        except BackendError as e:
            if e.status != 409:  # duplicate (job, kind, shot) = already recorded on a previous attempt
                raise

    def upload(self, bucket, path, local_file, content_type):
        data = Path(local_file).read_bytes()
        self._request("POST", f"/storage/v1/object/{bucket}/{urllib.parse.quote(path)}", headers={"Content-Type": content_type, "x-upsert": "true"}, raw=data)

    def download(self, bucket, path, dest_file):
        data = self._request("GET", f"/storage/v1/object/{bucket}/{urllib.parse.quote(path)}")
        Path(dest_file).parent.mkdir(parents=True, exist_ok=True)
        Path(dest_file).write_bytes(data if isinstance(data, bytes) else json.dumps(data).encode("utf-8"))


class StdioBackend:
    """Line-delimited JSON RPC: request `{"id", "op", "args"}` on stdout, response `{"id", "ok", "result"|"error"}` on stdin."""

    def __init__(self, stdin=None, stdout=None):
        self.stdin = stdin or sys.stdin
        self.stdout = stdout or sys.stdout
        self.lock = threading.Lock()
        self.seq = 0

    def call(self, op: str, **args: Any) -> Any:
        with self.lock:
            self.seq += 1
            self.stdout.write(json.dumps({"id": self.seq, "op": op, "args": args}, ensure_ascii=False) + "\n")
            self.stdout.flush()
            line = self.stdin.readline()
            if not line:
                raise BackendError("bridge closed")
            msg = json.loads(line)
            if msg.get("id") != self.seq:
                raise BackendError("bridge response out of order")
            if not msg.get("ok"):
                raise BackendError(str(msg.get("error")), msg.get("status"))
            return msg.get("result")

    def __getattr__(self, op: str):
        if op.startswith("_"):
            raise AttributeError(op)
        names = {
            "claim": ("job_types", "lease_seconds"),
            "heartbeat": ("job_id", "lease_epoch", "lease_seconds"),
            "complete": ("job_id", "lease_epoch", "status", "result", "error", "error_code"),
            "fail": ("job_id", "lease_epoch", "error", "retryable", "retry_delay_seconds", "error_code"),
            "get_plan": ("plan_id",), "list_shots": ("plan_id",), "get_asset": ("asset_id",),
            "update_shot": ("shot_id", "patch"), "update_plan": ("plan_id", "patch"),
            "insert_asset": ("row",), "insert_cost_entry": ("row",),
            "upload": ("bucket", "path", "local_file", "content_type"), "download": ("bucket", "path", "dest_file"),
        }
        if op not in names:
            raise AttributeError(op)

        def method(*a):
            return self.call(op, **dict(zip(names[op], a)))

        return method
