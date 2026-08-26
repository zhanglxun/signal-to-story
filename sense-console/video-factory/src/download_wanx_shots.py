"""
Poll and download generated DashScope Wanx video shots.
"""

import time
import requests
import os
from pathlib import Path

key = "sk-9a672a3e7f614e70b1d324d54a660517"
tasks = {
    "shot_003": "09d1b230-d681-477b-af21-1b89727fb587",
    "shot_004": "d322c4df-6aac-4ae0-80ed-c2e3e9672a77",
}

output_dir = Path("projects/demo_kids_candy_002/shots")
output_dir.mkdir(parents=True, exist_ok=True)

pending = dict(tasks)

print("⏳ Waiting for DashScope Wanx video rendering...")
while pending:
    for name, tid in list(pending.items()):
        url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{tid}"
        resp = requests.get(url, headers={"Authorization": f"Bearer {key}"}).json()
        status = resp.get("output", {}).get("task_status")
        print(f"  [{name}] Status: {status}")

        if status == "SUCCEEDED":
            video_url = resp.get("output", {}).get("video_url")
            out_file = output_dir / f"{name}.mp4"
            print(f"  ⬇️ Downloading [{name}] from {video_url[:60]}...")
            data = requests.get(video_url, timeout=60).content
            with open(out_file, "wb") as f:
                f.write(data)
            print(f"  ✅ Saved {out_file} (Size: {len(data):,} bytes)")
            del pending[name]
        elif status in ("FAILED", "CANCELED"):
            print(f"  ❌ [{name}] Failed: {resp}")
            del pending[name]

    if pending:
        time.sleep(10)

print("🎉 All DashScope tasks processed!")
