"""
Test DashScope Native Image and Video APIs.
"""

import requests
import json
from pathlib import Path

env_path = Path(__file__).resolve().parent.parent.parent / ".env.local"
env_vars = {}
with open(env_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip()

dashscope_key = env_vars.get("DASHSCOPE_API_KEY", "")

print("=== 1. Testing DashScope Native Image Generation (qwen-image-3.0 / wanx-v1) ===")
headers = {
    "Authorization": f"Bearer {dashscope_key}",
    "Content-Type": "application/json",
    "X-DashScope-Async": "enable"
}

# Test standard DashScope image generation
payload = {
    "model": "qwen-image-3.0",
    "input": {
        "prompt": "一只可爱的卡通小宇航员在发光的糖果星球上，3D皮克斯风格，9:16画幅"
    },
    "parameters": {
        "size": "720*1280",
        "n": 1
    }
}

try:
    resp = requests.post(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
        headers=headers,
        json=payload,
        timeout=15
    )
    print(f"Image API Status: {resp.status_code}")
    print(f"Image API Response: {resp.text}")
except Exception as e:
    print(f"Image Error: {e}")

print("\n=== 2. Testing DashScope Video Generation (wan2.7-t2v-2026-06-12) ===")
video_payload = {
    "model": "wan2.7-t2v-2026-06-12",
    "input": {
        "prompt": "小宇航员开心地走在糖果星球上，3D皮克斯动画风格"
    },
    "parameters": {
        "size": "720*1280"
    }
}

try:
    resp = requests.post(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis",
        headers=headers,
        json=video_payload,
        timeout=15
    )
    print(f"Video API Status: {resp.status_code}")
    print(f"Video API Response: {resp.text}")
except Exception as e:
    print(f"Video Error: {e}")
