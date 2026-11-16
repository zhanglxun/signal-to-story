// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { normalizeIntake } from "../../supabase/functions/intake-gateway/contract"
import { createHandler } from "../../supabase/functions/intake-gateway/handler"
const payload = {
  version: 1,
  intent: "capture",
  external_id: "dot-message-1",
  text: "把这篇文章收进选题池",
  url: "https://example.com/article",
  angle: "企业 AI 应用",
}
const token = "stk_" + "a".repeat(64)
function request(body: unknown = payload, authorization = `Bearer ${token}`) {
  return new Request("https://example.test/intake", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}
describe("external intake contract", () => {
  it("preserves raw input and does not fabricate article content", () => {
    const p = normalizeIntake(payload)
    expect(p.text).toBe(payload.text)
    expect(p.title).toBe(payload.text)
    expect(p.url).toBe(payload.url)
  })
  it("rejects tenant overrides, publishing commands, oversized input and unsafe URLs", () => {
    for (const p of [
      { ...payload, organization_id: "other" },
      { ...payload, intent: "publish" },
      { ...payload, text: "a".repeat(4001) },
      { ...payload, url: "javascript:alert(1)" },
      { ...payload, url: "https://user:password@example.com" },
    ])
      expect(() => normalizeIntake(p)).toThrow()
  })
  it("truncates fallback titles on Unicode boundaries", () =>
    expect(
      Array.from(normalizeIntake({ ...payload, text: "🌟".repeat(100) }).title)
    ).toHaveLength(64))
})
describe("gateway request authentication and errors", () => {
  it("rejects missing credentials before touching storage", async () => {
    const accept = vi.fn()
    const res = await createHandler(accept)(request(payload, ""))
    expect(res.status).toBe(401)
    expect(accept).not.toHaveBeenCalled()
  })
  it("passes only a digest and normalized input to storage", async () => {
    const accept = vi
      .fn()
      .mockResolvedValue({
        data: { status: "captured", selection_id: 42 },
        error: null,
      })
    const res = await createHandler(accept)(request())
    expect(res.status).toBe(200)
    expect(accept.mock.calls[0][0]).toMatch(/^[a-f0-9]{64}$/)
    expect(accept.mock.calls[0][0]).not.toContain(token)
    expect(accept.mock.calls[0][1]).toEqual(normalizeIntake(payload))
  })
  it.each([
    ["invalid_connection", 401],
    ["idempotency_conflict", 409],
    ["rate_limited", 429],
    ["database secret detail", 503],
  ])("maps %s without disclosing internals", async (message, status) => {
    const res = await createHandler(async () => ({
      data: null,
      error: { message },
    }))(request())
    expect(res.status).toBe(status)
    expect(await res.text()).not.toContain("database secret detail")
  })
  it("enforces body size even without content-length", async () => {
    const accept = vi.fn()
    const res = await createHandler(accept)(
      request({ ...payload, text: "x".repeat(25000) })
    )
    expect(res.status).toBe(413)
    expect(accept).not.toHaveBeenCalled()
  })
  it("does not write invalid input and recovers from transport errors", async () => {
    const accept = vi.fn().mockRejectedValue(new Error("secret"))
    expect(
      (await createHandler(accept)(request({ ...payload, intent: "publish" })))
        .status
    ).toBe(400)
    expect(accept).not.toHaveBeenCalled()
    const res = await createHandler(accept)(request())
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain("secret")
  })
})
