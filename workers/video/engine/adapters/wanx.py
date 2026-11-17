"""
Wanx Adapter: Alibaba Cloud DashScope (通义万相 / 千问生图与视频) Adapter.
Supports:
  - Text-to-Image (T2I): wanx-v1 / wanx2.1-t2i-turbo
  - Text-to-Video (T2V): wan2.7-t2v-2026-06-12 / wan3.0-video / happyhorse-1.1-t2v
  - Reference-to-Video (R2V/I2V): wan2.7-r2v-2026-06-12 / happyhorse-1.1-r2v
"""

import os
import time
import requests
from pathlib import Path
from typing import Dict, Any, List, Optional
from .base import BaseAdapter


class WanxAdapter(BaseAdapter):
    def __init__(self, api_key: Optional[str] = None, config: Optional[Dict[str, Any]] = None):
        super().__init__(name="wanx", config=config)
        # Priority: explicit key -> env var -> config -> .env.local
        self.api_key = api_key or os.environ.get("DASHSCOPE_API_KEY")
        if not self.api_key:
            self._load_key_from_env_local()

        self.base_url = "https://dashscope.aliyuncs.com/api/v1"

    def _load_key_from_env_local(self):
        candidate_paths = [
            Path(__file__).resolve().parent.parent.parent.parent / ".env.local",
            Path(__file__).resolve().parent.parent.parent / ".env.local",
        ]
        for p in candidate_paths:
            if p.exists():
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("DASHSCOPE_API_KEY="):
                            self.api_key = line.split("=", 1)[1].strip()
                            return

    def _get_headers(self) -> Dict[str, str]:
        if not self.api_key:
            raise ValueError("DASHSCOPE_API_KEY is not configured.")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }

    def _poll_task(self, task_id: str, poll_interval: int = 5, max_wait_sec: int = 300) -> Dict[str, Any]:
        url = f"{self.base_url}/tasks/{task_id}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        start_time = time.time()

        while time.time() - start_time < max_wait_sec:
            resp = requests.get(url, headers=headers, timeout=15)
            if resp.status_code != 200:
                raise RuntimeError(f"Failed to poll task {task_id}: {resp.text}")
            
            data = resp.json()
            task_status = data.get("output", {}).get("task_status")

            if task_status == "SUCCEEDED":
                return data
            elif task_status in ("FAILED", "CANCELED"):
                raise RuntimeError(f"DashScope task {task_id} {task_status}: {data}")

            time.sleep(poll_interval)

        raise TimeoutError(f"DashScope task {task_id} timed out after {max_wait_sec}s.")

    def generate_image(
        self,
        prompt: str,
        output_path: str,
        aspect_ratio: str = "9:16",
        ref_images: Optional[List[str]] = None,
        model: str = "wanx-v1",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Generate static image using Wanx / DashScope.
        """
        size = "720*1280" if aspect_ratio == "9:16" else ("1280*720" if aspect_ratio == "16:9" else "1024*1024")
        url = f"{self.base_url}/services/aigc/text2image/image-synthesis"
        payload = {
            "model": model,
            "input": {"prompt": prompt},
            "parameters": {"size": size, "n": 1}
        }

        resp = requests.post(url, headers=self._get_headers(), json=payload, timeout=20)
        if resp.status_code != 200:
            return {"success": False, "output_path": output_path, "cost": 0.0, "error": resp.text}

        task_id = resp.json().get("output", {}).get("task_id")
        result = self._poll_task(task_id)
        img_url = result.get("output", {}).get("results", [{}])[0].get("url")

        if not img_url:
            return {"success": False, "output_path": output_path, "cost": 0.0, "error": "No image URL returned"}

        # Download image
        img_data = requests.get(img_url, timeout=30).content
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(img_data)

        return {
            "success": True,
            "output_path": output_path,
            "cost": 0.05,
            "task_id": task_id,
            "model": model
        }

    def generate_video(
        self,
        prompt: str,
        output_path: str,
        first_frame: Optional[str] = None,
        duration_sec: float = 5.0,
        aspect_ratio: str = "9:16",
        ref_images: Optional[List[str]] = None,
        model: str = "wan2.7-t2v-2026-06-12",
        **kwargs
    ) -> Dict[str, Any]:
        """
        Generate video shot using Wanx T2V / R2V (wan2.7-t2v / wan2.7-r2v).
        """
        size = "720*1280" if aspect_ratio == "9:16" else ("1280*720" if aspect_ratio == "16:9" else "1024*1024")
        url = f"{self.base_url}/services/aigc/video-generation/video-synthesis"

        input_data: Dict[str, Any] = {"prompt": prompt}
        if first_frame and first_frame.startswith("http"):
            input_data["img_url"] = first_frame
            if "t2v" in model:
                model = model.replace("t2v", "r2v")

        payload = {
            "model": model,
            "input": input_data,
            "parameters": {"size": size}
        }

        resp = requests.post(url, headers=self._get_headers(), json=payload, timeout=20)
        if resp.status_code != 200:
            return {"success": False, "output_path": output_path, "cost": 0.0, "error": resp.text}

        task_id = resp.json().get("output", {}).get("task_id")
        result = self._poll_task(task_id, poll_interval=8, max_wait_sec=360)
        video_url = result.get("output", {}).get("video_url")

        if not video_url:
            return {"success": False, "output_path": output_path, "cost": 0.0, "error": "No video URL returned"}

        # Download video
        v_data = requests.get(video_url, timeout=60).content
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(v_data)

        return {
            "success": True,
            "output_path": output_path,
            "cost": 0.35,
            "task_id": task_id,
            "model": model
        }
