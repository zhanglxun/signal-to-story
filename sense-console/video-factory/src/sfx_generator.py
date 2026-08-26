"""
SFX Generator: Generates cute procedural sound effects for cartoon & fantasy animation.
"""

import math
import struct
import wave
import os
import subprocess
import random
from pathlib import Path


def generate_spaceship_hum(output_wav: str, duration_sec: float = 5.5):
    sample_rate = 44100
    total_samples = int(duration_sec * sample_rate)
    audio_data = []

    for i in range(total_samples):
        t = i / sample_rate
        # Low warm engine hum with subtle flutter
        base = math.sin(2 * math.pi * 65 * t) * 0.4
        sub = math.sin(2 * math.pi * 130 * t) * 0.2
        flutter = math.sin(2 * math.pi * 4 * t) * 0.1
        # Jet rush (gentle pink noise)
        noise = (random.random() * 2 - 1) * 0.05
        # Soft envelope fade in / fade out
        env = min(1.0, t / 0.5) * min(1.0, (duration_sec - t) / 0.5)
        audio_data.append((base + sub + flutter + noise) * env * 0.3)

    _write_wav(output_wav, audio_data, sample_rate)


def generate_sparkle(output_wav: str, duration_sec: float = 5.5):
    sample_rate = 44100
    total_samples = int(duration_sec * sample_rate)
    audio_data = [0.0] * total_samples

    # Random high pitched crystal chimes
    pitches = [1200, 1500, 1800, 2100, 2400, 2700, 3200]
    for _ in range(12):
        start_t = random.uniform(0.3, duration_sec - 1.0)
        freq = random.choice(pitches)
        start_idx = int(start_t * sample_rate)
        chime_len = int(0.6 * sample_rate)
        for j in range(chime_len):
            if start_idx + j >= total_samples:
                break
            tj = j / sample_rate
            env = math.exp(-6.0 * tj)
            val = math.sin(2 * math.pi * freq * tj) * env * 0.15
            audio_data[start_idx + j] += val

    _write_wav(output_wav, audio_data, sample_rate)


def generate_fireworks_burst(output_wav: str, duration_sec: float = 5.5):
    sample_rate = 44100
    total_samples = int(duration_sec * sample_rate)
    audio_data = [0.0] * total_samples

    # 3 firework bursts
    for burst_t in [0.8, 2.2, 3.6]:
        start_idx = int(burst_t * sample_rate)
        # Low boom + crackle
        burst_len = int(1.5 * sample_rate)
        for j in range(burst_len):
            if start_idx + j >= total_samples:
                break
            tj = j / sample_rate
            boom_env = math.exp(-4.0 * tj)
            boom = math.sin(2 * math.pi * (80 - tj * 30) * tj) * boom_env * 0.4
            crackle = (random.random() * 2 - 1) * math.exp(-2.5 * tj) * 0.15
            audio_data[start_idx + j] += boom + crackle

    _write_wav(output_wav, audio_data, sample_rate)


def _write_wav(output_wav: str, audio_data: list, sample_rate: int):
    os.makedirs(os.path.dirname(os.path.abspath(output_wav)), exist_ok=True)
    max_val = max(abs(x) for x in audio_data) or 1.0
    with wave.open(output_wav, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for s in audio_data:
            val = int((s / max_val) * 26000)
            frames.extend(struct.pack("<h", max(-32767, min(32767, val))))
        wf.writeframes(frames)


def convert_wav_to_mp3(wav_path: str, mp3_path: str, ffmpeg_path: str = "/opt/homebrew/bin/ffmpeg"):
    subprocess.run([ffmpeg_path, "-y", "-i", wav_path, "-c:a", "libmp3lame", "-b:a", "192k", mp3_path],
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    if os.path.exists(wav_path):
        os.remove(wav_path)


def generate_all_sfx_for_project(project_dir: str):
    sfx_dir = Path(project_dir) / "sfx"
    sfx_dir.mkdir(parents=True, exist_ok=True)

    # 1. spaceship_hum
    wav1 = str(sfx_dir / "shot_001_sfx.wav")
    mp31 = str(sfx_dir / "shot_001_sfx.mp3")
    generate_spaceship_hum(wav1)
    convert_wav_to_mp3(wav1, mp31)

    # 2. sparkle (stepping on candy)
    wav2 = str(sfx_dir / "shot_002_sfx.wav")
    mp32 = str(sfx_dir / "shot_002_sfx.mp3")
    generate_sparkle(wav2)
    convert_wav_to_mp3(wav2, mp32)

    # 3. sparkle (jelly bunny)
    wav3 = str(sfx_dir / "shot_003_sfx.wav")
    mp33 = str(sfx_dir / "shot_003_sfx.mp3")
    generate_sparkle(wav3)
    convert_wav_to_mp3(wav3, mp33)

    # 4. fireworks
    wav4 = str(sfx_dir / "shot_004_sfx.wav")
    mp34 = str(sfx_dir / "shot_004_sfx.mp3")
    generate_fireworks_burst(wav4)
    convert_wav_to_mp3(wav4, mp34)

    # 5. cozy hum
    wav5 = str(sfx_dir / "shot_005_sfx.wav")
    mp35 = str(sfx_dir / "shot_005_sfx.mp3")
    generate_spaceship_hum(wav5)
    convert_wav_to_mp3(wav5, mp35)

    print(f"🎵 [SFX] Procedural sound effects generated in {sfx_dir}")
