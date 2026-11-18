// @vitest-environment node
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi } from "vitest"

import { type PendingNotice, runNotifierOnce } from "./im-notify.ts"

describe("polling notifier", () => {
  const env = { FEISHU_APP_ID: "a", FEISHU_APP_SECRET: "s", CONSOLE_BASE_URL: "https://story.test" }
  const job: PendingNotice = {
    kind: "job", id: "j1", organization_id: "o", status: "pending_review", job_id: "j1", work_item_id: "w1",
    platform: "x", title: "T", rounds: 2, max_rounds: 3, reply_to: { channel: "feishu", target: "oc_1" },
  }
  const okFetch = () =>
    vi.fn(async (u: string, _i: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true, status: 200, json: async () => (u.includes("tenant_access") ? { code: 0, tenant_access_token: "t", expire: 7200 } : { code: 0 }) }))
  const fakeRpc = (notices: PendingNotice[]) =>
    vi.fn(async (fn: string, _args: Record<string, unknown>) => ({ data: fn === "list_pending_notices" ? notices : true, error: null }))

  it("sends a Feishu card to the stored conversation, then marks it", async () => {
    const rpc = fakeRpc([job])
    const f = okFetch()
    expect(await runNotifierOnce({ rpc, env, fetch: f })).toEqual([{ id: "j1", kind: "job", result: "sent", reason: undefined }])
    const sent = JSON.parse(JSON.parse(f.mock.calls[1][1].body).content)
    expect(JSON.stringify(sent)).toContain("https://story.test/work-items/w1")
    expect(JSON.stringify(sent)).toContain("评估轮数：2/3")
    expect(rpc).toHaveBeenCalledWith("mark_notice_sent", { p_kind: "job", p_id: "j1", p_status: "pending_review" })
  })

  it("leaves a failed send unmarked so the next poll retries it", async () => {
    const rpc = fakeRpc([job])
    const failing = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    expect((await runNotifierOnce({ rpc, env, fetch: failing }))[0]).toMatchObject({ result: "failed", reason: "delivery_failed" })
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["list_pending_notices"])
  })

  it("marks notices without a deliverable IM target as handled, without sending", async () => {
    const rpc = fakeRpc([{ ...job, reply_to: null }, { ...job, id: "j2", job_id: "j2", reply_to: { channel: "wecom", target: null } }])
    const f = okFetch()
    const out = await runNotifierOnce({ rpc, env, fetch: f })
    expect(out.map((o) => [o.result, o.reason])).toEqual([["skipped", "no_im_target"], ["skipped", "wecom_unavailable"]])
    expect(f).not.toHaveBeenCalled()
    expect(rpc.mock.calls.filter((c) => c[0] === "mark_notice_sent")).toHaveLength(2)
  })

  it("posts WeCom Markdown for an agent question and never throws when listing fails", async () => {
    const f = vi.fn(async (_u: string, _i: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true, status: 200, json: async () => ({}) }))
    const question: PendingNotice = { kind: "question", id: "q1", organization_id: "o", status: "pending", job_id: "j1", summary: "用哪个角度？", title: "T", reply_to: { channel: "wecom", target: null } }
    const out = await runNotifierOnce({ rpc: fakeRpc([question]), env: { WECOM_NOTIFY_WEBHOOK_URL: "https://qy.test/hook?key=k", CONSOLE_BASE_URL: "https://story.test" }, fetch: f })
    expect(out[0].result).toBe("sent")
    expect(f.mock.calls[0][0]).toBe("https://qy.test/hook?key=k")
    expect(JSON.parse(f.mock.calls[0][1].body).markdown.content).toContain("Agent 提问")
    const log = vi.fn()
    expect(await runNotifierOnce({ rpc: async () => ({ data: null, error: { message: "down" } }), env, log })).toEqual([])
    expect(log).toHaveBeenCalledWith("notice_list_failed", { error: "down" })
  })
})
