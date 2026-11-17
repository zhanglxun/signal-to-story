"""
Local Ken Burns Adapter: High-performance, zero-cost camera motion engine using FFmpeg.
Converts static keyframe images into smooth cinematic pan/zoom video clips.
"""

import os
import subprocess
import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional
from .base import BaseAdapter


class LocalKenBurnsAdapter(BaseAdapter):
    def __init__(self, ffmpeg_path: str = "ffmpeg", config: Optional[Dict[str, Any]] = None):
        super().__init__(name="local_kenburns", config=config)
        # Find ffmpeg in PATH or fallback to specified path
        self.ffmpeg_path = shutil.which(ffmpeg_path) or ffmpeg_path
        if not shutil.which(self.ffmpeg_path) and os.path.exists("/opt/homebrew/bin/ffmpeg"):
            self.ffmpeg_path = "/opt/homebrew/bin/ffmpeg"

    def generate_image(
        self,
        prompt: str,
        output_path: str,
        aspect_ratio: str = "9:16",
        ref_images: Optional[List[str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Local Ken Burns does not generate images by itself."""
        return {
            "success": False,
            "output_path": output_path,
            "cost": 0.0,
            "error": "LocalKenBurnsAdapter is a motion engine, not an image generator.",
        }

    def generate_video(
        self,
        prompt: str,
        output_path: str,
        first_frame: Optional[str] = None,
        duration_sec: float = 5.0,
        aspect_ratio: str = "9:16",
        ref_images: Optional[List[str]] = None,
        camera_motion: str = "zoom_in",
        target_resolution: str = "1080x1920",
        fps: int = 30,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Generate a video shot with smooth camera motion from first_frame image.
        """
        if not first_frame or not os.path.exists(first_frame):
            return {
                "success": False,
                "output_path": output_path,
                "cost": 0.0,
                "error": f"First frame image not found: {first_frame}",
            }

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        width, height = target_resolution.split("x")
        w, h = int(width), int(height)
        total_frames = int(duration_sec * fps)

        # Normalize camera motion string
        motion = (camera_motion or "zoom_in").lower()

        # Build FFmpeg zoompan filter
        # zoompan: z=zoom expression, x=horizontal offset, y=vertical offset, d=duration in frames, s=output size
        if "out" in motion:
            # Slow zoom-out (from 1.15 to 1.0)
            zoom_expr = f"if(lte(zoom,1.0),1.15,max(1.001,zoom-0.15/{total_frames}))"
            x_expr = "iw/2-(iw/zoom/2)"
            y_expr = "ih/2-(ih/zoom/2)"
        elif "left" in motion:
            # Pan left to right
            zoom_expr = "1.15"
            x_expr = f"(on/{total_frames})*(iw-iw/zoom)"
            y_expr = "ih/2-(ih/zoom/2)"
        elif "right" in motion:
            # Pan right to left
            zoom_expr = "1.15"
            x_expr = f"(1-on/{total_frames})*(iw-iw/zoom)"
            y_expr = "ih/2-(ih/zoom/2)"
        elif "up" in motion:
            # Pan down to up
            zoom_expr = "1.15"
            x_expr = "iw/2-(iw/zoom/2)"
            y_expr = f"(1-on/{total_frames})*(ih-ih/zoom)"
        else:
            # Default: Slow zoom-in (from 1.0 to 1.15)
            zoom_expr = f"min(zoom+0.15/{total_frames},1.15)"
            x_expr = "iw/2-(iw/zoom/2)"
            y_expr = "ih/2-(ih/zoom/2)"

        filter_complex = (
            f"scale={w*2}:{h*2}:force_original_aspect_ratio=increase,"
            f"crop={w*2}:{h*2},"
            f"zoompan=z='{zoom_expr}':x='{x_expr}':y='{y_expr}':d={total_frames}:s={w}x{h}:fps={fps},"
            f"format=yuv420p"
        )

        cmd = [
            self.ffmpeg_path,
            "-y",
            "-loop", "1",
            "-i", str(Path(first_frame).resolve()),
            "-vf", filter_complex,
            "-t", str(duration_sec),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            str(Path(output_path).resolve())
        ]

        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True
            )
            return {
                "success": True,
                "output_path": output_path,
                "cost": 0.0,
                "duration_sec": duration_sec,
                "adapter": self.name
            }
        except subprocess.CalledProcessError as e:
            return {
                "success": False,
                "output_path": output_path,
                "cost": 0.0,
                "error": f"FFmpeg error: {e.stderr}"
            }

    def estimate_cost(self, mode: str, duration_sec: float = 5.0) -> float:
        return 0.0
