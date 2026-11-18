// @vitest-environment node
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi } from "vitest"

import { notifyJobNeedsHuman } from "./im-notify.ts"

describe("worker review notifier", () => {
  const target = { channel: "feishu", reply_target: "oc_1", status: "pending_review", rounds: 2, max_rounds: 3, work_item_id: "w1", platform: "x", title: "T" }
  const env = { FEISHU_APP_ID: "a", FEISHU_APP_SECRET: "s", CONSOLE_BASE_URL: "https://story.test" }
  const okFetch = () =>
    vi.fn(async (u: string, _i: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true, status: 200, json: async () => (u.includes("tenant_access") ? { code: 0, tenant_access_token: "t", expire: 7200 } : { code: 0 }) }))

  it("is a no-op when unconfigured, not IM-originated, or the status is not notifiable", async () => {
    const rpc = vi.fn(async () => ({ data: target, error: null }))
    expect(await notifyJobNeedsHuman({ rpc, env: {} }, { id: "j", status: "pending_review" })).toEqual({ sent: false, reason: "not_configured" })
    expect(rpc).not.toHaveBeenCalled()
    expect(await notifyJobNeedsHuman({ rpc: async () => ({ data: null, error: null }), env, fetch: okFetch() }, { id: "j", status: "pending_review" })).toEqual({ sent: false, reason: "no_im_target" })
    expect(await notifyJobNeedsHuman({ rpc, env }, { id: "j", status: "succeeded" })).toEqual({ sent: false, reason: "status_not_notifiable" })
  })

  it("sends a Feishu card to the stored conversation and swallows delivery errors", async () => {
    const f = okFetch()
    const r = await notifyJobNeedsHuman({ rpc: async () => ({ data: target, error: null }), env, fetch: f }, { id: "j1", status: "blocked_needs_human" })
    expect(r).toEqual({ sent: true })
    const sent = JSON.parse(JSON.parse(f.mock.calls[1][1].body).content)
    expect(JSON.stringify(sent)).toContain("https://story.test/work-items/w1")
    const failing = await notifyJobNeedsHuman({ rpc: async () => ({ data: target, error: null }), env, fetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) }, { id: "j1", status: "pending_review" })
    expect(failing).toEqual({ sent: false, reason: "delivery_failed" })
  })

  it("posts WeCom Markdown through the group robot webhook", async () => {
    const f = vi.fn(async (_u: string, _i: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true, status: 200, json: async () => ({}) }))
    const r = await notifyJobNeedsHuman(
      { rpc: async () => ({ data: { ...target, channel: "wecom", reply_target: null }, error: null }), env: { WECOM_NOTIFY_WEBHOOK_URL: "https://qy.test/hook?key=k", CONSOLE_BASE_URL: "https://story.test" }, fetch: f },
      { id: "j1", status: "pending_review" }
    )
    expect(r.sent).toBe(true)
    expect(f.mock.calls[0][0]).toBe("https://qy.test/hook?key=k")
  })
})
