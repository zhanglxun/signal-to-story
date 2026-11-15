import json
import unittest

from video_worker.contract import FIXTURES_PATH, ContractError, align_shot_duration, estimate_shot_cost_cents, load_schema, validate_job, validate_result

FIX = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))


class ContractTest(unittest.TestCase):
    def test_schema_generated_from_zod(self):
        schema = load_schema()
        self.assertEqual(schema["schema_version"], 1)
        self.assertEqual(set(schema["$defs"]), {"job", "result", "plan_draft"})

    def test_valid_jobs(self):
        for case in FIX["valid_jobs"]:
            with self.subTest(case["name"]):
                validate_job(case["job"])

    def test_invalid_jobs(self):
        for case in FIX["invalid_jobs"] + FIX["semantic_invalid_jobs"]:
            with self.subTest(case["name"]):
                with self.assertRaises(ContractError):
                    validate_job(case["job"])

    def test_results(self):
        for result in FIX["valid_results"]:
            validate_result(result)
        with self.assertRaises(ContractError):
            validate_result({**FIX["valid_results"][0], "cost_cents": -1})

    def test_alignment_vectors_match_typescript(self):
        for i, v in enumerate(FIX["alignment_vectors"]):
            with self.subTest(i):
                inp = v["input"]
                self.assertEqual(align_shot_duration(inp["narrationMs"], inp["targetMs"], inp["motionMode"]).as_dict(), v["expected"])

    def test_cost_vectors_match_typescript(self):
        for i, v in enumerate(FIX["cost_vectors"]):
            with self.subTest(i):
                s = v["shot"]
                self.assertEqual(estimate_shot_cost_cents(s["motionMode"], s["targetDurationMs"], s["actualDurationMs"], s["narration"], v["ttsProvider"]), v["expected"])


if __name__ == "__main__":
    unittest.main()
