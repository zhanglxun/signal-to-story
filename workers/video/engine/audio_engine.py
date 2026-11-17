"""
Audio Engine: Audio-First Voiceover & Subtitle Generator using Edge-TTS.
Features retry logic and precise duration extraction.
"""

import asyncio
import os
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
import edge_tts
from mutagen.mp3 import MP3


def format_srt_time(seconds: float) -> str:
    """Format seconds into SRT timestamp: HH:MM:SS,mmm"""
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        secs += 1
        millis -= 1000
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


class AudioEngine:
    def __init__(
        self,
        default_voice: str = "zh-CN-XiaoxiaoNeural",
        default_rate: str = "+0%",
        default_pitch: str = "+0Hz",
    ):
        self.default_voice = default_voice
        self.default_rate = default_rate
        self.default_pitch = default_pitch

    async def generate_single_shot_audio(
        self,
        text: str,
        output_path: str,
        voice: Optional[str] = None,
        rate: Optional[str] = None,
        pitch: Optional[str] = None,
        max_retries: int = 3,
    ) -> float:
        """
        Generate audio for a single shot with retry logic, and return its exact duration in seconds.
        """
        v = voice or self.default_voice
        r = rate or self.default_rate
        p = pitch or self.default_pitch

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        for attempt in range(1, max_retries + 1):
            try:
                communicate = edge_tts.Communicate(text=text, voice=v, rate=r, pitch=p)
                await communicate.save(output_path)
                # Extract duration
                audio_info = MP3(output_path)
                return float(audio_info.info.length)
            except Exception as e:
                print(f"    ⚠️ [Attempt {attempt}/{max_retries}] TTS failed ({e}), retrying...")
                if attempt < max_retries:
                    await asyncio.sleep(2 * attempt)
                else:
                    if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
                        print("    ℹ️ Fallback to existing audio file.")
                        audio_info = MP3(output_path)
                        return float(audio_info.info.length)
                    raise e

        return 5.0

    async def process_video_plan(
        self,
        plan_path: str,
        project_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process an entire video_plan.json:
        1. Synthesize audio for each shot
        2. Update shot.duration_sec with exact audio length (+ padding)
        3. Generate subtitle (.srt)
        4. Save updated video_plan.json
        """
        plan_file = Path(plan_path)
        with open(plan_file, "r", encoding="utf-8") as f:
            plan = json.load(f)

        base_dir = Path(project_dir) if project_dir else plan_file.parent
        audio_dir = base_dir / "audio"
        subtitles_dir = base_dir / "subtitles"
        audio_dir.mkdir(parents=True, exist_ok=True)
        subtitles_dir.mkdir(parents=True, exist_ok=True)

        meta = plan.get("meta", {})
        voice = meta.get("voice", self.default_voice)
        rate = meta.get("voice_rate", self.default_rate)
        pitch = meta.get("voice_pitch", self.default_pitch)

        shots = plan.get("shots", [])
        current_time = 0.0
        srt_entries: List[str] = []

        print(f"🎙️ [AudioEngine] Processing audio for {len(shots)} shots with voice '{voice}'...")

        for idx, shot in enumerate(shots, 1):
            shot_id = shot.get("id", f"shot_{idx:03d}")
            voiceover = shot.get("voiceover", "").strip()
            audio_filename = f"{shot_id}.mp3"
            audio_filepath = str(audio_dir / audio_filename)

            if not voiceover:
                duration = shot.get("duration_sec", 3.0)
                print(f"  [{shot_id}] No voiceover, duration: {duration:.2f}s")
            else:
                raw_duration = await self.generate_single_shot_audio(
                    text=voiceover,
                    output_path=audio_filepath,
                    voice=voice,
                    rate=rate,
                    pitch=pitch,
                )
                duration = round(raw_duration + 0.3, 2)
                shot["duration_sec"] = duration
                shot["audio_file"] = str(Path("audio") / audio_filename)
                shot["status"] = "audio_generated"

                print(f"  ✅ [{shot_id}] Audio ready: {duration:.2f}s -> {voiceover}")

                # Build SRT subtitle entry
                start_str = format_srt_time(current_time)
                end_str = format_srt_time(current_time + raw_duration)
                srt_entry = f"{idx}\n{start_str} --> {end_str}\n{voiceover}\n"
                srt_entries.append(srt_entry)

            current_time += duration

        # Write subtitle file
        srt_filepath = subtitles_dir / "subtitles.srt"
        with open(srt_filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(srt_entries))
        print(f"📝 [AudioEngine] Subtitles written to: {srt_filepath}")

        # Update and save plan
        plan["meta"]["total_duration_sec"] = round(current_time, 2)
        plan["meta"]["subtitles_file"] = str(Path("subtitles") / "subtitles.srt")
        with open(plan_file, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)

        print(f"🎉 [AudioEngine] Total audio length: {current_time:.2f}s. Plan updated.")
        return plan


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate audio & subtitles for video plan")
    parser.add_argument("--plan", required=True, help="Path to video_plan.json")
    parser.add_argument("--voice", default="zh-CN-XiaoxiaoNeural", help="Edge-TTS voice name")
    args = parser.parse_args()

    engine = AudioEngine(default_voice=args.voice)
    asyncio.run(engine.process_video_plan(args.plan))
