import shutil
import tempfile
import unittest
import wave
from pathlib import Path

from video_worker.engines import DryRunEngine, MediaResult, ShotSpec, estimate_narration_ms


def spec(motion="local_ken_burns", ms=1200):
    return ShotSpec("s1", 1, motion, "zoom_in", "画面", "旁白", "zh-CN-XiaoxiaoNeural", ms, 5 if motion == "cloud_video_model" else None, "9:16")


class DryRunEngineTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_silent_voiceover_has_estimated_length(self):
        media = DryRunEngine(use_ffmpeg=False).synthesize("一二三四五六七八九", "v", self.dir / "a")
        self.assertTrue(media.placeholder)
        self.assertEqual(media.duration_ms, estimate_narration_ms("一二三四五六七八九"))
        with wave.open(str(media.path)) as w:
            self.assertAlmostEqual(w.getnframes() / w.getframerate() * 1000, media.duration_ms, delta=2)

    def test_keyframe_png_and_placeholder_clip_without_ffmpeg(self):
        engine = DryRunEngine(use_ffmpeg=False)
        kf = engine.keyframe(spec(), self.dir / "k")
        self.assertEqual(kf.path.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
        clip = engine.render_shot(spec("cloud_video_model"), kf.path, self.dir / "c")
        self.assertEqual(clip.mime_type, "text/plain")
        self.assertTrue(any("NOT called" in w for w in clip.warnings))
        final = engine.compose([clip], [None], "9:16", None, self.dir, self.dir / "f")
        self.assertEqual(final.mime_type, "text/plain")

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    def test_real_ken_burns_and_composer_with_ffmpeg(self):
        engine = DryRunEngine()
        kf = engine.keyframe(spec(), self.dir / "k")
        clip = engine.render_shot(spec(ms=1000), kf.path, self.dir / "c")
        self.assertEqual(clip.mime_type, "video/mp4")
        self.assertGreater(clip.path.stat().st_size, 1000)
        audio = engine.synthesize("一句旁白", "v", self.dir / "a")
        final = engine.compose([MediaResult(clip.path, "video/mp4", 1000)], [audio], "9:16", None, self.dir, self.dir / "final")
        self.assertEqual(final.mime_type, "video/mp4")
        self.assertGreater(final.path.stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()
