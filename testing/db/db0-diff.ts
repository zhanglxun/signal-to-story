/**
 * DB0: compare the live schema snapshot with the repo migrations (read-only, no network).
 *
 *   npx tsx testing/db/db0-diff.ts <live-snapshot.json> [upTo-migration-file] > report.md
 *
 * <live-snapshot.json> is the single cell returned by supabase/snippets/schema_snapshot.sql.
 * upTo defaults to the last version recorded in the live migration history.
 */
import { readFileSync } from "node:fs"

import { diffSnapshots, parseSnapshotFile, renderDiffMarkdown, snapshotRepo } from "./schema-snapshot"

const DEFAULT_UP_TO = "20261030023526_site_entries_publish_guard.sql" // last version in the live history

const [file, upTo = DEFAULT_UP_TO] = process.argv.slice(2)
if (!file) {
  console.error("usage: npx tsx testing/db/db0-diff.ts <live-snapshot.json> [upTo-migration-file]")
  process.exit(2)
}
const remote = parseSnapshotFile(readFileSync(file, "utf8"))
const { snapshot, applied } = await snapshotRepo(upTo)
process.stdout.write(renderDiffMarkdown(diffSnapshots(remote, snapshot), { upTo, applied: applied.length }))
