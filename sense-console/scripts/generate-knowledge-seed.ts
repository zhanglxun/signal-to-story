/**
 * `npm run kb:seed`           regenerate src/data/knowledge-base-defaults.generated.ts + supabase/seeds/knowledge_base.sql
 * `npm run kb:seed -- --check` exit 1 if the generated files are out of date
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { GENERATED_SQL, GENERATED_TS, loadRepositoryKnowledge, renderGeneratedTs, renderSeedSql } from "./knowledge-seed"

const entries = loadRepositoryKnowledge()
const outputs: Array<[string, string]> = [
  [GENERATED_TS, renderGeneratedTs(entries)],
  [GENERATED_SQL, renderSeedSql(entries)],
]

if (process.argv.includes("--check")) {
  const stale = outputs.filter(([file, content]) => {
    try {
      return readFileSync(file, "utf8") !== content
    } catch {
      return true
    }
  })
  for (const [file] of stale) console.error(`out of date: ${file}`)
  process.exitCode = stale.length ? 1 : 0
} else {
  for (const [file, content] of outputs) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
    console.log(`wrote ${file}`)
  }
  console.log(`${entries.length} entries: ${entries.map((e) => e.slug).join(", ")}`)
}
