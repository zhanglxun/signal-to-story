// @vitest-environment node
import { describe, expect, it } from "vitest"

import { collectAuditData, describeCheck } from "./catalog"

describe("schema audit page data", () => {
  it("has a category and a Chinese meaning for every table and column the migrations create", async () => {
    const data = await collectAuditData()
    expect(data.missing).toEqual([])
    const tables = data.categories.flatMap((c) => c.tables)
    expect(tables.find((t) => t.name === "approval_requests")?.columns.map((c) => c.name)).toContain("question")
    expect(tables.filter((t) => t.draft).map((t) => t.name)).toContain("work_items")
  })

  it("turns common single-column checks into short Chinese notes", () => {
    expect(describeCheck("CHECK ((status = ANY (ARRAY['a'::text, 'b'::text])))")).toBe("取值：a / b")
    expect(describeCheck("CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 36)))")).toBe("去空格后 1–36 字")
    expect(describeCheck("CHECK (((error IS NULL) OR (char_length(error) <= 4000)))")).toBe("≤ 4000 字")
    expect(describeCheck("CHECK (((jsonb_typeof(payload) = 'object'::text) AND (pg_column_size(payload) <= 262144)))")).toBe("JSON 对象，≤ 262144 字节")
    expect(describeCheck("CHECK ((bucket = 'site-resources'::text))")).toMatch(/^check /)
  })
})
