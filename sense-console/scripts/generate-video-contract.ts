/** `npm run video:contract` — writes workers/video/contract/video-job.schema.json from the zod contract. */
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { videoJobJsonSchema } from "../src/contracts/video-studio"

export const VIDEO_CONTRACT_SCHEMA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../workers/video/contract/video-job.schema.json")

export function renderVideoContractSchema(): string {
  return `${JSON.stringify(videoJobJsonSchema(), null, 2)}\n`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(VIDEO_CONTRACT_SCHEMA_PATH, renderVideoContractSchema())
  console.log(`wrote ${VIDEO_CONTRACT_SCHEMA_PATH}`)
}
