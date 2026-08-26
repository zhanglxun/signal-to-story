"""
Video Engine: Dispatches each shot to either local motion engine (FFmpeg) or cloud video model adapter (Wanx, etc.).
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional
from adapters.local_kenburns import LocalKenBurnsAdapter
from adapters.wanx import WanxAdapter


class VideoEngine:
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.local_kenburns = LocalKenBurnsAdapter()
        self._wanx_adapter: Optional[WanxAdapter] = None

    def get_adapter(self, adapter_name: str):
        if adapter_name == "wanx":
            if self._wanx_adapter is None:
                self._wanx_adapter = WanxAdapter()
            return self._wanx_adapter
        return self.local_kenburns

    def process_video_plan(
        self,
        plan_path: str,
        project_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process all shots in video_plan.json:
        Generates individual video clips for each shot.
        """
        plan_file = Path(plan_path).resolve()
        base_dir = Path(project_dir).resolve() if project_dir else plan_file.parent

        with open(plan_file, "r", encoding="utf-8") as f:
            plan = json.load(f)

        meta = plan.get("meta", {})
        target_resolution = meta.get("target_resolution", "1080x1920")
        aspect_ratio = meta.get("aspect_ratio", "9:16")
        shots = plan.get("shots", [])

        shots_dir = base_dir / "shots"
        shots_dir.mkdir(parents=True, exist_ok=True)

        print(f"🎬 [VideoEngine] Processing {len(shots)} shots for project '{plan.get('project_id')}'...")

        for idx, shot in enumerate(shots, 1):
            shot_id = shot.get("id", f"shot_{idx:03d}")
            duration_sec = shot.get("duration_sec", 4.5)
            camera = shot.get("camera", "zoom_in")
            shot_type = shot.get("type", "pan_zoom")
            adapter_name = shot.get("motion_adapter", "local_kenburns")

            # Resolve keyframe path
            kf_rel = shot.get("keyframe_image")
            if kf_rel:
                kf_path = base_dir / kf_rel
            else:
                kf_path = base_dir / "keyframes" / f"{shot_id}.png"

            output_shot_path = shots_dir / f"{shot_id}.mp4"
            prompt = shot.get("visual_prompt", "")

            print(f"  🎥 Rendering [{shot_id}] via [{adapter_name}] ({shot_type}/{camera}) -> Duration: {duration_sec:.2f}s...")

            adapter = self.get_adapter(adapter_name)
            
            if adapter_name == "wanx":
                # Call Wanx Video Generation
                res = adapter.generate_video(
                    prompt=prompt,
                    output_path=str(output_shot_path),
                    first_frame=str(kf_path) if kf_path.exists() else None,
                    duration_sec=duration_sec,
                    aspect_ratio=aspect_ratio,
                    model="wan2.7-t2v-2026-06-12",
                )
            else:
                if not kf_path.exists():
                    raise FileNotFoundError(f"Keyframe image not found for {shot_id}: {kf_path}")
                # Call Local Ken Burns Motion
                res = adapter.generate_video(
                    prompt=prompt,
                    output_path=str(output_shot_path),
                    first_frame=str(kf_path),
                    duration_sec=duration_sec,
                    camera_motion=camera,
                    target_resolution=target_resolution,
                )

            if not res.get("success"):
                raise RuntimeError(f"Failed to render shot {shot_id}: {res.get('error')}")

            shot["output_video"] = str(Path("shots") / f"{shot_id}.mp4")
            shot["status"] = "rendered"
            shot["cost"] = res.get("cost", 0.0)
            print(f"  ✅ [{shot_id}] Rendered -> {output_shot_path.name} (Cost: ¥{res.get('cost', 0.0)})")

        # Update and save plan
        with open(plan_file, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)

        print(f"🎉 [VideoEngine] All {len(shots)} video shots generated successfully!")
        return plan


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Render video shots for video plan")
    parser.add_argument("--plan", required=True, help="Path to video_plan.json")
    args = parser.parse_args()

    engine = VideoEngine()
    engine.process_video_plan(args.plan)
