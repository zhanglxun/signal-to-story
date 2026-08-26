"""
Test script for DashScope and Token-Plan endpoints.
"""

import os
import requests
import json
from pathlib import Path

# Load .env.local from sense-console/.env.local or project root
candidate_paths = [
    Path(__file__).resolve().parent.parent.parent / ".env.local",
    Path(__file__).resolve().parent.parent / ".env.local",
]

env_vars = {}
for p in candidate_paths:
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip()
        print(f"Loaded config from {p}")
        break

dashscope_key = env_vars.get("DASHSCOPE_API_KEY", "")
dashscope_base = env_vars.get("DASHSCOPE_BASE_URL", "")
token_plan_base = env_vars.get("OPENAI_BASE_URL", "")
token_plan_key = env_vars.get("API_KEY", "")

print("=== 1. Testing LLM Chat via Token-Plan (OpenAI Compatible) ===")
try:
    headers = {
        "Authorization": f"Bearer {token_plan_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "qwen3.7-max",
        "messages": [{"role": "user", "content": "你好，请用一句话介绍你自己。"}]
    }
    url = f"{token_plan_base.rstrip('/')}/chat/completions"
    print(f"Calling: {url}")
    resp = requests.post(url, headers=headers, json=payload, timeout=20)
    print(f"Status: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        print("Response:", data["choices"][0]["message"]["content"])
    else:
        print("Error:", resp.text)
except Exception as e:
    print(f"Exception: {e}")

print("\n=== 2. Testing Image Generation via DashScope / Token-Plan ===")
try:
    headers = {
        "Authorization": f"Bearer {dashscope_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "qwen-image-3.0",
        "prompt": "一只可爱的卡通小宇航员在发光的糖果星球上，3D皮克斯风格，9:16画幅",
        "n": 1,
        "size": "1024x1024"
    }
    url = f"{dashscope_base.rstrip('/')}/images/generations"
    print(f"Calling: {url}")
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    print(f"Status: {resp.status_code}")
    print("Response:", resp.text[:300])
except Exception as e:
    print(f"Exception: {e}")
