"""
Composer: Multi-track Video & Audio Assembly Engine using FFmpeg.
Concatenates video shots (with resolution normalization), syncs voiceover audio, mixes BGM with ducking, mixes SFX tracks, and burns/multiplexes subtitles.
"""

import os
import json
import subprocess
import shutil
import time
from pathlib import Path
from typing import Dict, Any, List, Optional


class Composer:
    def __init__(self, ffmpeg_path: str = "ffmpeg", ffprobe_path: str = "ffprobe"):
        self.ffmpeg_path = shutil.which(ffmpeg_path) or ffmpeg_path
        if not shutil.which(self.ffmpeg_path) and os.path.exists("/opt/homebrew/bin/ffmpeg"):
            self.ffmpeg_path = "/opt/homebrew/bin/ffmpeg"

        self.ffprobe_path = shutil.which(ffprobe_path) or ffprobe_path
        if not shutil.which(self.ffprobe_path) and os.path.exists("/opt/homebrew/bin/ffprobe"):
            self.ffprobe_path = "/opt/homebrew/bin/ffprobe"

    def assemble(
        self,
        plan_path: str,
        project_dir: Optional[str] = None,
        bgm_path: Optional[str] = None,
        output_filename: str = "final_video.mp4",
    ) -> Dict[str, Any]:
        """
        Assemble the final video with multi-track audio (Voiceover + BGM + SFX).
        """
        start_time = time.time()
        plan_file = Path(plan_path).resolve()
        base_dir = Path(project_dir).resolve() if project_dir else plan_file.parent

        with open(plan_file, "r", encoding="utf-8") as f:
            plan = json.load(f)

        meta = plan.get("meta", {})
        target_res = meta.get("target_resolution", "1080x1920")
        w_str, h_str = target_res.split("x")
        w, h = int(w_str), int(h_str)

        shots = plan.get("shots", [])
        output_dir = base_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        final_video_path = output_dir / output_filename
        report_path = output_dir / "generation_report.json"

        # 1. Collect video shots, audio shots & sfx shots
        video_files: List[Path] = []
        audio_files: List[Path] = []
        sfx_files: List[Path] = []

        for shot in shots:
            shot_id = shot.get("id")
            # Video shot path
            video_rel = shot.get("output_video")
            if video_rel:
                v_path = base_dir / video_rel
            else:
                v_path = base_dir / "shots" / f"{shot_id}.mp4"

            if not v_path.exists():
                raise FileNotFoundError(f"Missing video shot file: {v_path}")
            video_files.append(v_path)

            # Audio shot path
            audio_rel = shot.get("audio_file")
            if audio_rel:
                a_path = base_dir / audio_rel
            else:
                a_path = base_dir / "audio" / f"{shot_id}.mp3"
            
            if a_path.exists():
                audio_files.append(a_path)

            # SFX shot path
            sfx_rel = shot.get("sfx_file")
            if sfx_rel:
                s_path = base_dir / sfx_rel
            else:
                s_path = base_dir / "sfx" / f"{shot_id}_sfx.mp3"

            if s_path.exists():
                sfx_files.append(s_path)

        print(f"🎬 [Composer] Assembling {len(video_files)} video shots, {len(audio_files)} voice tracks, {len(sfx_files)} SFX tracks...")

        # 2. Normalize & Concat video shots using filter_complex concat
        # We build: [0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v0]; ... [v0][v1]concat=n=N:v=1:a=0[vmerged]
        norm_inputs = []
        filter_chains = []
        v_pads = []

        for idx, v in enumerate(video_files):
            norm_inputs.extend(["-i", str(v)])
            filter_chains.append(
                f"[{idx}:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps=30,setsar=1[v{idx}]"
            )
            v_pads.append(f"[v{idx}]")

        filter_chains.append(f"{''.join(v_pads)}concat=n={len(v_pads)}:v=1:a=0[vmerged]")
        merged_video_filter = ";".join(filter_chains)

        merged_video_raw = output_dir / "temp_merged_video.mp4"
        cmd_concat_v = (
            [self.ffmpeg_path, "-y"]
            + norm_inputs
            + ["-filter_complex", merged_video_filter, "-map", "[vmerged]", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", str(merged_video_raw)]
        )
        print("  🎥 Normalizing & concatenating video shots...")
        subprocess.run(cmd_concat_v, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # 3. Concat voiceover audio
        merged_voice_raw = output_dir / "temp_merged_voice.mp3"
        if audio_files:
            concat_voice_list = output_dir / "concat_voice.txt"
            with open(concat_voice_list, "w", encoding="utf-8") as f:
                for a in audio_files:
                    f.write(f"file '{a.as_posix()}'\n")

            cmd_concat_a = [
                self.ffmpeg_path,
                "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_voice_list),
                "-c:a", "libmp3lame",
                "-q:a", "2",
                str(merged_voice_raw)
            ]
            subprocess.run(cmd_concat_a, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # 4. Concat SFX audio
        merged_sfx_raw = output_dir / "temp_merged_sfx.mp3"
        if len(sfx_files) == len(video_files):
            concat_sfx_list = output_dir / "concat_sfx.txt"
            with open(concat_sfx_list, "w", encoding="utf-8") as f:
                for s in sfx_files:
                    f.write(f"file '{s.as_posix()}'\n")

            cmd_concat_s = [
                self.ffmpeg_path,
                "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_sfx_list),
                "-c:a", "libmp3lame",
                "-q:a", "2",
                str(merged_sfx_raw)
            ]
            subprocess.run(cmd_concat_s, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # 5. Mix Voiceover + BGM + SFX + Subtitles
        bgm_to_use = bgm_path or meta.get("bgm_track")
        bgm_file = None
        if bgm_to_use:
            cand = Path(bgm_to_use)
            if cand.is_absolute() and cand.exists():
                bgm_file = cand
            else:
                for root in [base_dir.parent.parent, base_dir]:
                    if (root / bgm_to_use).exists():
                        bgm_file = (root / bgm_to_use).resolve()
                        break

        # Subtitles file
        srt_file = base_dir / "subtitles" / "subtitles.srt"
        has_subtitles = srt_file.exists()

        cmd_final = [self.ffmpeg_path, "-y", "-i", str(merged_video_raw)]
        input_idx = 1

        voice_idx = None
        if merged_voice_raw.exists():
            cmd_final.extend(["-i", str(merged_voice_raw)])
            voice_idx = input_idx
            input_idx += 1

        bgm_idx = None
        if bgm_file and bgm_file.exists():
            cmd_final.extend(["-stream_loop", "-1", "-i", str(bgm_file)])
            bgm_idx = input_idx
            input_idx += 1

        sfx_idx = None
        if merged_sfx_raw.exists():
            cmd_final.extend(["-i", str(merged_sfx_raw)])
            sfx_idx = input_idx
            input_idx += 1

        sub_idx = None
        if has_subtitles:
            cmd_final.extend(["-i", str(srt_file)])
            sub_idx = input_idx
            input_idx += 1

        # Build multi-track audio mixing filter graph
        audio_inputs = []
        filter_parts = []

        if voice_idx is not None:
            filter_parts.append(f"[{voice_idx}:a]volume=1.0[voice]")
            audio_inputs.append("[voice]")

        if bgm_idx is not None:
            filter_parts.append(f"[{bgm_idx}:a]volume=0.09[bgm]")
            audio_inputs.append("[bgm]")

        if sfx_idx is not None:
            filter_parts.append(f"[{sfx_idx}:a]volume=0.35[sfx]")
            audio_inputs.append("[sfx]")

        if len(audio_inputs) > 1:
            inputs_str = "".join(audio_inputs)
            filter_parts.append(f"{inputs_str}amix=inputs={len(audio_inputs)}:duration=first:dropout_transition=2[aout]")
            audio_filter = ";".join(filter_parts)
            cmd_final.extend(["-filter_complex", audio_filter, "-map", "0:v", "-map", "[aout]"])
        elif len(audio_inputs) == 1:
            cmd_final.extend(["-map", "0:v", "-map", f"{voice_idx}:a"])
        else:
            cmd_final.extend(["-map", "0:v"])

        if sub_idx is not None:
            cmd_final.extend(["-map", f"{sub_idx}:s", "-c:s", "mov_text"])

        cmd_final.extend([
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            str(final_video_path)
        ])

        print("⚡ [Composer] Running final multi-track muxing & assembly...")
        subprocess.run(cmd_final, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Cleanup temp files
        for temp_f in [
            merged_video_raw,
            merged_voice_raw,
            merged_sfx_raw,
            output_dir / "concat_voice.txt",
            output_dir / "concat_sfx.txt",
        ]:
            if temp_f.exists():
                temp_f.unlink()

        elapsed_sec = round(time.time() - start_time, 2)
        total_cost = sum(shot.get("cost", 0.0) for shot in shots)

        # Write generation report
        report = {
            "project_id": plan.get("project_id"),
            "title": plan.get("title"),
            "total_duration_sec": meta.get("total_duration_sec", 0.0),
            "render_time_sec": elapsed_sec,
            "total_shots": len(shots),
            "total_cost_cny": round(total_cost, 4),
            "output_video": str(final_video_path),
            "subtitles_included": has_subtitles,
            "bgm_used": bool(bgm_file and bgm_file.exists()),
            "sfx_tracks": len(sfx_files),
            "completed_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }

        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        print(f"🎉 [Composer] Final video generated successfully in {elapsed_sec}s!")
        print(f"📁 Output file: {final_video_path}")
        return report


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Assemble final video from video_plan.json")
    parser.add_argument("--plan", required=True, help="Path to video_plan.json")
    parser.add_argument("--bgm", default=None, help="Path to BGM audio file")
    args = parser.parse_args()

    composer = Composer()
    composer.assemble(args.plan, bgm_path=args.bgm)
