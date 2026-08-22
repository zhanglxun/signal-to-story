"""
Master Pipeline: End-to-end one-click video creation pipeline.
Usage:
    python src/pipeline.py --project demo_kids_candy_001
    python src/pipeline.py --project demo_kids_candy_001 --step audio
    python src/pipeline.py --project demo_kids_candy_001 --step render
    python src/pipeline.py --project demo_kids_candy_001 --step compose
"""

import os
import sys
import asyncio
import argparse
from pathlib import Path

# Add src to sys.path
SRC_DIR = Path(__file__).resolve().parent
ROOT_DIR = SRC_DIR.parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from audio_engine import AudioEngine
from video_engine import VideoEngine
from composer import Composer


def run_pipeline(
    project_id: str,
    step: str = "all",
    bgm_track: str = "assets/bgm/cheerful_fantasy.mp3",
):
    project_dir = ROOT_DIR / "projects" / project_id
    plan_path = project_dir / "video_plan.json"

    if not plan_path.exists():
        raise FileNotFoundError(f"Project plan not found: {plan_path}")

    print(f"\n========================================================")
    print(f"🚀 [Pipeline] Running Signal to Story Video Factory")
    print(f"🎯 Project: {project_id}")
    print(f"🔧 Target Step: {step}")
    print(f"========================================================\n")

    # Step 1: Audio & Subtitles
    if step in ("all", "audio"):
        print("--- [Step 1/3] Synthesizing Voiceover & Subtitles (Audio-First) ---")
        audio_engine = AudioEngine()
        asyncio.run(audio_engine.process_video_plan(str(plan_path), str(project_dir)))

    # Step 2: Video Shots Rendering
    if step in ("all", "render"):
        print("\n--- [Step 2/3] Rendering Video Shots (Motion & Adapters) ---")
        video_engine = VideoEngine()
        video_engine.process_video_plan(str(plan_path), str(project_dir))

    # Step 3: Final Assembly
    if step in ("all", "compose"):
        print("\n--- [Step 3/3] Final Video Assembly & Sound Mixing ---")
        composer = Composer()
        report = composer.assemble(str(plan_path), str(project_dir), bgm_path=bgm_track)
        print(f"\n🎉 [SUCCESS] Pipeline completed!")
        print(f"📼 Video Output: {report['output_video']}")
        print(f"⏱️ Total Duration: {report['total_duration_sec']}s")
        print(f"💰 Total Cost: ¥{report['total_cost_cny']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Signal to Story Master Video Pipeline")
    parser.add_argument("--project", required=True, help="Project directory name inside projects/")
    parser.add_argument(
        "--step",
        choices=["all", "audio", "render", "compose"],
        default="all",
        help="Pipeline step to execute (default: all)",
    )
    parser.add_argument(
        "--bgm",
        default="assets/bgm/cheerful_fantasy.mp3",
        help="Path to background music track",
    )
    args = parser.parse_args()

    run_pipeline(project_id=args.project, step=args.step, bgm_track=args.bgm)
