/** `npm --prefix sense-console run demo:video` — end-to-end Video Studio demo (PGlite + fake LLM + Python dry-run worker). */
import { runVideoStudioDemo } from "./video-studio-demo"

runVideoStudioDemo({ print: (line) => console.log(line), engine: process.env.SENSE_VIDEO_DEMO_ENGINE })
  .then((report) => {
    if (!report.ok) process.exitCode = 1
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
