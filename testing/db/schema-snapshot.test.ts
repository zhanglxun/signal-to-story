// @vitest-environment node
import { describe, expect, it } from "vitest"

import { diffSnapshots, parseSnapshotFile, renderDiffMarkdown, snapshotRepo } from "./schema-snapshot"

const V1 = "20261006141445_intake_remote_oauth.sql"

describe("DB0 schema snapshot", () => {
  it("runs the read-only snapshot query on the repo migrations and finds the V1 tables", async () => {
    const { snapshot, applied } = await snapshotRepo(V1)
    expect(applied.at(-1)).toBe(V1)
    const tables = snapshot.tables.map((t) => `${t.schema}.${t.name}`)
    for (const t of ["public.signals", "public.content_documents", "public.intake_oauth_tokens"]) expect(tables).toContain(t)
    expect(tables).not.toContain("public.agent_jobs")
    expect(snapshot.policies.length).toBeGreaterThan(0)
    expect(snapshot.functions.some((f) => f.name === "accept_intake")).toBe(true)
  })

  it("parses SQL-editor exports and reports drift in both directions", async () => {
    const { snapshot } = await snapshotRepo(V1)
    const exported = JSON.stringify([{ snapshot: JSON.stringify(snapshot) }])
    expect(parseSnapshotFile(exported)).toEqual(snapshot)

    const live = structuredClone(snapshot)
    live.tables.push({ schema: "public", name: "site_release_sources", kind: "r", rls: true })
    live.columns = live.columns.map((c) => (c.tbl === "signals" && c.name === "summary" ? { ...c, nullable: !c.nullable } : c))
    const diff = diffSnapshots(live, snapshot)
    expect(diff.tables.onlyRemote).toEqual(["public.site_release_sources"])
    expect(diff.columns.changed.map((c) => c.key)).toEqual(["public.signals.summary"])
    expect(renderDiffMarkdown(diff, { upTo: V1, applied: 13 })).toContain("site_release_sources")
  })

  it("ignores environment noise: NOT NULL constraint rows, platform storage triggers, extensions. prefix", async () => {
    const { snapshot } = await snapshotRepo(V1)
    const live = structuredClone(snapshot)
    live.constraints = live.constraints.filter((k) => k.type !== "n")
    live.triggers.push({ schema: "storage", tbl: "buckets", name: "protect_buckets_delete",
      def: "CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_delete()" })
    live.indexes = live.indexes.map((i) => ({ ...i, def: String(i.def).replace(/\bextensions\./g, "") }))
    const diff = diffSnapshots(live, snapshot)
    for (const c of Object.values(diff)) expect([c.onlyRemote, c.onlyRepo, c.changed].flat()).toEqual([])
  })
})
