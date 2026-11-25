// @vitest-environment node
/* eslint-disable @typescript-eslint/no-unused-vars */
import { readFileSync } from "node:fs"
import { Buffer } from "node:buffer"
import { describe, expect, it, vi } from "vitest"

import { buildFeishuReviewCard, createFeishuSender, encryptFeishu, feishuSignature, parseFeishuRequest } from "./feishu.ts"
import { createImHandler, parseRoute, type RpcResult } from "./handler.ts"
import { buildReceiptText, extractUrls, idempotencyKey, parseIntent, type ImCaptureInput, type ReviewNotice } from "./shared.ts"
import {
  buildWecomReply,
  buildWecomReviewMarkdown,
  handleWecomVerifyUrl,
  parseWecomRequest,
  sendWecomGroupMarkdown,
  wecomDecrypt,
  wecomEncrypt,
  wecomSignature,
} from "./wecom.ts"

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")
const NOW = Date.parse("2026-11-15T10:00:00Z")
const ts = String(NOW / 1000)
const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k] ?? null })
const CONN = "11111111-2222-3333-4444-555555555555"

const FEISHU = { verificationToken: "vt_test_token", now: NOW }
const FEISHU_ENC = { ...FEISHU, encryptKey: "encrypt_key_test" }
function signedFeishu(plain: string, key = "encrypt_key_test", timestamp = ts) {
  const body = JSON.stringify({ encrypt: encryptFeishu(plain, key, Buffer.alloc(16, 7)) })
  const nonce = "nonce1"
  return { body, headers: headers({ "X-Lark-Request-Timestamp": timestamp, "X-Lark-Request-Nonce": nonce, "X-Lark-Signature": feishuSignature(timestamp, nonce, key, body) }) }
}

describe("feishu adapter", () => {
  it("answers the url_verification handshake and rejects a wrong token", () => {
    const r = parseFeishuRequest(fx("feishu-url-verification.json"), headers({}), FEISHU)
    expect(r).toEqual({ kind: "challenge", response: { challenge: "ajls384kdjx98XX" } })
    const bad = parseFeishuRequest(fx("feishu-url-verification.json").replace("vt_test_token", "nope"), headers({}), FEISHU)
    expect(bad).toMatchObject({ kind: "rejected", status: 401 })
  })

  it("verifies signature, decrypts, and parses an encrypted text event (mentions stripped)", () => {
    const s = signedFeishu(fx("feishu-message-text.json"))
    const r = parseFeishuRequest(s.body, s.headers, FEISHU_ENC)
    expect(r).toMatchObject({ kind: "message", messageId: "om_dc13264520392913993dd051dba21dcf", chatId: "oc_5ad11d72b830411d72b836c20", messageType: "text" })
    if (r.kind === "message") expect(r.text).toBe("出稿 写成小红书和公众号 https://example.com/a。")
  })

  it("rejects bad signature, stale timestamp (replay), missing headers, plaintext downgrade", () => {
    const s = signedFeishu(fx("feishu-message-text.json"))
    const tampered = { ...s, headers: headers({ "X-Lark-Request-Timestamp": ts, "X-Lark-Request-Nonce": "nonce1", "X-Lark-Signature": "0".repeat(64) }) }
    expect(parseFeishuRequest(s.body, tampered.headers, FEISHU_ENC)).toMatchObject({ kind: "rejected", reason: "bad_signature" })
    const old = signedFeishu(fx("feishu-message-text.json"), "encrypt_key_test", String(NOW / 1000 - 3600))
    expect(parseFeishuRequest(old.body, old.headers, FEISHU_ENC)).toMatchObject({ kind: "rejected", reason: "stale_timestamp" })
    expect(parseFeishuRequest(s.body, headers({}), FEISHU_ENC)).toMatchObject({ kind: "rejected", reason: "missing_headers" })
    expect(parseFeishuRequest(fx("feishu-message-text.json"), headers({}), FEISHU_ENC)).toMatchObject({ kind: "rejected", reason: "encryption_required" })
    const wrongKey = signedFeishu(fx("feishu-message-text.json"), "other_key")
    expect(parseFeishuRequest(wrongKey.body, wrongKey.headers, FEISHU_ENC)).toMatchObject({ kind: "rejected", status: 401 })
    // wrong verification token inside a valid envelope
    const badToken = signedFeishu(fx("feishu-message-text.json").replace("vt_test_token", "evil"))
    expect(parseFeishuRequest(badToken.body, badToken.headers, FEISHU_ENC)).toMatchObject({ kind: "rejected", reason: "bad_token" })
  })

  it("handles encrypted url_verification and plaintext mode (token only)", () => {
    const enc = signedFeishu(fx("feishu-url-verification.json"))
    expect(parseFeishuRequest(enc.body, headers({}), FEISHU_ENC)).toMatchObject({ kind: "challenge" })
    expect(parseFeishuRequest(fx("feishu-message-text.json"), headers({}), FEISHU)).toMatchObject({ kind: "message" })
    expect(parseFeishuRequest(enc.body, headers({}), FEISHU)).toMatchObject({ kind: "rejected", reason: "unexpected_encryption" })
  })

  it("extracts links from rich text (post) including anchor hrefs", () => {
    const r = parseFeishuRequest(fx("feishu-message-post.json"), headers({}), FEISHU)
    expect(r).toMatchObject({ kind: "message", messageType: "post", urls: ["https://example.com/post"] })
    if (r.kind === "message") expect(r.text).toContain("这篇讲 Agent 评估：原文")
  })

  it("acknowledges card actions without any approval behavior and ignores unknown events", () => {
    const r = parseFeishuRequest(fx("feishu-card-action.json"), headers({}), FEISHU)
    expect(r.kind).toBe("card_action")
    expect(JSON.stringify(r)).not.toMatch(/approve|decide/)
    expect(parseFeishuRequest(fx("feishu-unknown-event.json"), headers({}), FEISHU)).toEqual({ kind: "ignored", reason: "unsupported_event_type" })
    expect(parseFeishuRequest("not json", headers({}), FEISHU)).toMatchObject({ kind: "rejected", status: 400 })
  })

  it("builds a review card with exactly two link buttons and no callback value", () => {
    const card = buildFeishuReviewCard(notice({ summary: "<at id=all></at> 摘要" })) as { elements: Array<Record<string, unknown>>; header: { title: { content: string } } }
    const action = card.elements.find((e) => e.tag === "action") as { actions: Array<{ url: string; value?: unknown; text: { content: string } }> }
    expect(action.actions.map((a) => a.text.content)).toEqual(["查看并审核", "打开任务"])
    expect(action.actions.every((a) => a.url.startsWith("https://story.test/") && a.value === undefined)).toBe(true)
    expect(card.header.title.content).toContain("待审核")
    expect(JSON.stringify(card)).toContain("评估轮数：2/3")
    expect(JSON.stringify(card)).not.toContain('"tag":"lark_md"') // untrusted text is only rendered as plain_text
  })

  it("sender fetches a tenant token once and posts the card (fetch injected)", async () => {
    const calls: Array<{ url: string; body: string; auth?: string }> = []
    const fetchMock = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, body: init.body, auth: init.headers.Authorization })
      return { ok: true, status: 200, json: async () => (url.includes("tenant_access_token") ? { code: 0, tenant_access_token: "t-abc", expire: 7200 } : { code: 0 }) }
    })
    const sender = createFeishuSender({ appId: "cli_x", appSecret: "secret", fetch: fetchMock, now: () => NOW })
    await sender.sendCard("oc_1", { a: 1 })
    await sender.replyText("om_1", "hi")
    expect(calls.map((c) => c.url)).toEqual([
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
      "https://open.feishu.cn/open-apis/im/v1/messages/om_1/reply",
    ])
    expect(calls[1].auth).toBe("Bearer t-abc")
  })
})

const WECOM_KEY = Buffer.alloc(32, 9).toString("base64").replace(/=+$/, "")
const WECOM = { token: "wecom_token", encodingAesKey: WECOM_KEY, now: NOW }
function wecomRequest(plain: string, timestamp = ts, nonce = "n123") {
  const encrypt = wecomEncrypt(plain, WECOM_KEY, "", Buffer.alloc(16, 1))
  return { body: JSON.stringify({ encrypt }), q: { msg_signature: wecomSignature(WECOM.token, timestamp, nonce, encrypt), timestamp, nonce } }
}

describe("wecom adapter", () => {
  it("encrypt/decrypt roundtrip with receiveid empty", () => {
    const enc = wecomEncrypt("你好 hello", WECOM_KEY, "", Buffer.alloc(16, 3))
    expect(wecomDecrypt(enc, WECOM_KEY)).toEqual({ msg: "你好 hello", receiveId: "" })
  })

  it("URL verification: valid, bad signature, stale", () => {
    const encrypt = wecomEncrypt("1616140317555161061", WECOM_KEY)
    const q = { msg_signature: wecomSignature(WECOM.token, ts, "nn", encrypt), timestamp: ts, nonce: "nn", echostr: encrypt }
    expect(handleWecomVerifyUrl(q, WECOM)).toEqual({ ok: true, echo: "1616140317555161061" })
    expect(handleWecomVerifyUrl({ ...q, msg_signature: "f".repeat(40) }, WECOM)).toMatchObject({ ok: false, status: 401, reason: "bad_signature" })
    const old = String(NOW / 1000 - 4000)
    expect(handleWecomVerifyUrl({ ...q, timestamp: old, msg_signature: wecomSignature(WECOM.token, old, "nn", encrypt) }, WECOM)).toMatchObject({ ok: false, reason: "stale_timestamp" })
    expect(handleWecomVerifyUrl({ ...q, echostr: null }, WECOM)).toMatchObject({ ok: false, status: 400 })
  })

  it("parses text (group mention stripped), mixed (text items only), and ignores events", () => {
    const t = wecomRequest(fx("wecom-text.json"))
    const r = parseWecomRequest(t.body, t.q, WECOM)
    expect(r).toMatchObject({ kind: "message", messageId: "MSGID_0001", chatId: "CHATID_1", userId: "zhangsan" })
    if (r.kind === "message") expect(r.text).toBe("收藏一下 https://example.com/b 企业落地的角度")
    const m = wecomRequest(fx("wecom-mixed.json"))
    const mr = parseWecomRequest(m.body, m.q, WECOM)
    if (mr.kind === "message") expect(mr.text).toBe("做这个 视频号\nhttps://example.com/c")
    const e = wecomRequest(fx("wecom-event.json"))
    expect(parseWecomRequest(e.body, e.q, WECOM)).toMatchObject({ kind: "ignored" })
  })

  it("rejects replayed (stale), tampered and unsigned requests", () => {
    const old = wecomRequest(fx("wecom-text.json"), String(NOW / 1000 - 3600))
    expect(parseWecomRequest(old.body, old.q, WECOM)).toMatchObject({ kind: "rejected", reason: "stale_timestamp" })
    const ok = wecomRequest(fx("wecom-text.json"))
    expect(parseWecomRequest(ok.body, { ...ok.q, msg_signature: "0".repeat(40) }, WECOM)).toMatchObject({ kind: "rejected", reason: "bad_signature" })
    expect(parseWecomRequest(ok.body, { timestamp: ts, nonce: "n123" }, WECOM)).toMatchObject({ kind: "rejected", reason: "missing_params" })
  })

  it("builds a verifiable encrypted stream reply and a link-only Markdown notice", () => {
    const reply = buildWecomReply("已收录", WECOM, { nonce: "n9" }, "stream-1", { now: NOW })
    expect(reply.msgsignature).toBe(wecomSignature(WECOM.token, String(reply.timestamp), "n9", reply.encrypt))
    expect(JSON.parse(wecomDecrypt(reply.encrypt, WECOM_KEY).msg)).toEqual({ msgtype: "stream", stream: { id: "stream-1", finish: true, content: "已收录" } })
    const md = buildWecomReviewMarkdown(notice({ title: "<script>x</script>`a`" }))
    expect(md).toContain("[查看并审核](https://story.test/work-items/w1)")
    expect(md).not.toMatch(/<script>|`/)
  })

  it("pushes group markdown through the injected fetch and surfaces failures", async () => {
    const f = vi.fn(async (_u: string, _i: { method: string; headers: Record<string, string>; body: string }) => ({ ok: true, status: 200 }))
    await sendWecomGroupMarkdown("https://qy.test/hook?key=k", "hi", f)
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ msgtype: "markdown", markdown: { content: "hi" } })
    await expect(sendWecomGroupMarkdown("https://qy.test/hook?key=k", "hi", async () => ({ ok: false, status: 500 }))).rejects.toThrow("wecom_push_500")
  })
})

describe("intent parsing and idempotency keys", () => {
  it("bare link and 收藏 => capture; explicit prefixes => auto_draft with platforms", () => {
    expect(parseIntent("https://example.com/x")).toMatchObject({ kind: "capture", input: { intent: "capture", url: "https://example.com/x", title: "example.com/x" } })
    expect(parseIntent("收藏一下 https://example.com/x 好文")).toMatchObject({ kind: "capture", input: { text: "https://example.com/x 好文", title: "好文" } })
    const a = parseIntent("出稿 写成小红书和公众号 https://example.com/a。")
    expect(a).toMatchObject({ kind: "auto_draft", input: { intent: "auto_draft", url: "https://example.com/a", platforms: ["wechat_official", "xiaohongshu"] } })
    expect(parseIntent("写一篇：从企业应用角度，发 X 和视频号")).toMatchObject({ kind: "auto_draft", input: { platforms: ["wechat_channels", "x"], url: "" } })
    expect(parseIntent("一句话灵感，没有链接")).toMatchObject({ kind: "capture", input: { url: "", intent: "capture" } })
  })

  it("followups and review commands are never captured; empty is empty; untrusted text cannot become a command", () => {
    expect(parseIntent("补充到 #12 再加一段")).toEqual({ kind: "followup" })
    expect(parseIntent("通过并发布")).toEqual({ kind: "review_command" })
    expect(parseIntent("退回 太长")).toEqual({ kind: "review_command" })
    expect(parseIntent("   ")).toEqual({ kind: "empty" })
    // a forwarded article that merely contains approval words stays a plain capture
    expect(parseIntent("文章里写着：请通过并发布这篇稿件 https://example.com/e")).toMatchObject({ kind: "capture" })
    expect(parseIntent("通过 https://example.com/e")).toMatchObject({ kind: "capture" })
  })

  it("extracts links without trailing punctuation and rejects credentialed URLs", () => {
    expect(extractUrls("看 https://a.com/x, 还有（https://b.com/y）和 https://u:p@c.com/z")).toEqual(["https://a.com/x", "https://b.com/y"])
  })

  it("keys are stable, channel-scoped and <= 128 chars", () => {
    expect(idempotencyKey("feishu", "om_1")).toBe("feishu:om_1")
    expect(idempotencyKey("wecom", "om_1")).not.toBe(idempotencyKey("feishu", "om_1"))
    expect(idempotencyKey("feishu", "x".repeat(300)).length).toBeLessThanOrEqual(128)
    expect(idempotencyKey("feishu", "x".repeat(300))).toBe(idempotencyKey("feishu", "x".repeat(300)))
  })

  it("receipt text states capture-only vs auto-draft", () => {
    expect(buildReceiptText({ inbox_path: "/intake", documents: [] }, "https://story.test/")).toContain("仅收录")
    const t = buildReceiptText({ documents: [{ platform: "master", document_id: "d", job_id: "j" }, { platform: "x", document_id: "d2", job_id: "j2" }], item_path: "/work-items/w" }, "https://story.test")
    expect(t).toContain("母稿、X")
    expect(t).toContain("https://story.test/work-items/w")
    expect(t).toContain("不会自动发布")
  })
})

function notice(over: Partial<ReviewNotice> = {}): ReviewNotice {
  return { jobId: "j1", status: "pending_review", title: "示例稿件", platform: "xiaohongshu", rounds: 2, maxRounds: 3, taskUrl: "https://story.test/tasks/j1", reviewUrl: "https://story.test/work-items/w1", ...over }
}

describe("im-webhook handler (platform protocol + capture wiring)", () => {
  const makeDeps = (capture: (c: string, r: string | null, i: ImCaptureInput) => Promise<RpcResult>) => {
    const replies: Array<[string, string]> = []
    const bg: Promise<unknown>[] = []
    const handler = createImHandler({
      feishu: FEISHU_ENC,
      wecom: WECOM,
      feishuSender: { replyText: async (id, text) => void replies.push([id, text]), sendCard: async () => {} },
      consoleBaseUrl: "https://story.test",
      capture,
      background: (p) => void bg.push(p),
      newStreamId: () => "sid",
    })
    return { handler, replies, flush: () => Promise.all(bg) }
  }
  const url = `https://x.supabase.co/functions/v1/im-webhook/feishu/${CONN}`
  const post = (u: string, body: string, h: Record<string, string> = {}) => new Request(u, { method: "POST", headers: h, body })
  const reqFrom = (s: ReturnType<typeof signedFeishu>) =>
    post(url, s.body, { "X-Lark-Request-Timestamp": s.headers.get("X-Lark-Request-Timestamp")!, "X-Lark-Request-Nonce": "nonce1", "X-Lark-Signature": s.headers.get("X-Lark-Signature")! })
  const ok: RpcResult = { data: { event_id: "c1", duplicate: false, inbox_path: "/intake", documents: [{ platform: "master", document_id: "d", job_id: "j" }], item_path: "/work-items/w" }, error: null }

  it("routes, ignores unknown paths, and 503s unconfigured channels", async () => {
    expect(parseRoute(new URL(url))).toEqual({ channel: "feishu", connectionId: CONN })
    expect(parseRoute(new URL("https://x/im-webhook/dingtalk/" + CONN))).toBeNull()
    const { handler } = makeDeps(async () => ok)
    expect((await handler(post("https://x/im-webhook/feishu/not-a-uuid", "{}"))).status).toBe(404)
  })

  it("feishu: handshake, then message -> capture with message_id as external id, receipt sent in background", async () => {
    const capture = vi.fn(async (_c: string, _r: string | null, _i: ImCaptureInput) => ok)
    const { handler, replies, flush } = makeDeps(capture)
    const hs = signedFeishu(fx("feishu-url-verification.json"))
    const hr = await handler(post(url, hs.body))
    expect(await hr.json()).toEqual({ challenge: "ajls384kdjx98XX" })
    const res = await handler(reqFrom(signedFeishu(fx("feishu-message-text.json"))))
    expect(res.status).toBe(200)
    await flush()
    expect(capture).toHaveBeenCalledTimes(1)
    const [conn, target, input] = capture.mock.calls[0]
    expect(conn).toBe(CONN)
    expect(target).toBe("oc_5ad11d72b830411d72b836c20")
    expect(input).toMatchObject({ version: 1, intent: "auto_draft", external_id: "feishu:om_dc13264520392913993dd051dba21dcf", platforms: ["wechat_official", "xiaohongshu"] })
    expect(replies[0][0]).toBe("om_dc13264520392913993dd051dba21dcf")
    expect(replies[0][1]).toContain("自动出稿")
  })

  it("feishu: duplicate delivery gets no second receipt; transient failure => 503 (platform retries); revoked => 401", async () => {
    const dup = makeDeps(async () => ({ data: { ...(ok.data as object), duplicate: true }, error: null }))
    expect((await dup.handler(reqFrom(signedFeishu(fx("feishu-message-text.json"))))).status).toBe(200)
    await dup.flush()
    expect(dup.replies).toHaveLength(0)
    const down = makeDeps(async () => ({ data: null, error: { message: "connection reset" } }))
    expect((await down.handler(reqFrom(signedFeishu(fx("feishu-message-text.json"))))).status).toBe(503)
    const revoked = makeDeps(async () => ({ data: null, error: { code: "28000", message: "invalid_connection" } }))
    expect((await revoked.handler(reqFrom(signedFeishu(fx("feishu-message-text.json"))))).status).toBe(401)
  })

  it("feishu: review commands are answered with a hint and never reach capture; bad signature is 401", async () => {
    const capture = vi.fn(async () => ok)
    const { handler, replies, flush } = makeDeps(capture)
    const msg = JSON.parse(fx("feishu-message-text.json"))
    msg.event.message.content = JSON.stringify({ text: "通过并发布" })
    msg.event.message.mentions = []
    await handler(reqFrom(signedFeishu(JSON.stringify(msg))))
    await flush()
    expect(capture).not.toHaveBeenCalled()
    expect(replies[0][1]).toContain("IM 不执行批准")
    const s = signedFeishu(fx("feishu-message-text.json"))
    const bad = post(url, s.body, { "X-Lark-Request-Timestamp": ts, "X-Lark-Request-Nonce": "nonce1", "X-Lark-Signature": "0".repeat(64) })
    expect((await handler(bad)).status).toBe(401)
    expect((await handler(new Request(url, { method: "GET" }))).status).toBe(405)
  })

  it("wecom: GET handshake and POST message with an encrypted passive reply", async () => {
    const capture = vi.fn(async (_c: string, _r: string | null, _i: ImCaptureInput) => ok)
    const { handler } = makeDeps(capture)
    const wurl = `https://x/functions/v1/im-webhook/wecom/${CONN}`
    const echo = wecomEncrypt("echo-123", WECOM_KEY)
    const gq = new URLSearchParams({ msg_signature: wecomSignature(WECOM.token, ts, "n1", echo), timestamp: ts, nonce: "n1", echostr: echo })
    const g = await handler(new Request(`${wurl}?${gq}`))
    expect(await g.text()).toBe("echo-123")
    const r = wecomRequest(fx("wecom-text.json"))
    const pq = new URLSearchParams({ msg_signature: r.q.msg_signature, timestamp: r.q.timestamp, nonce: r.q.nonce })
    const res = await handler(post(`${wurl}?${pq}`, r.body))
    expect(res.status).toBe(200)
    const reply = (await res.json()) as { encrypt: string; nonce: string }
    expect(reply.nonce).toBe("n123")
    expect(JSON.parse(wecomDecrypt(reply.encrypt, WECOM_KEY).msg).stream.content).toContain("已收录")
    expect(capture.mock.calls[0][2]).toMatchObject({ intent: "capture", external_id: "wecom:MSGID_0001" })
    const bad = await handler(post(`${wurl}?${new URLSearchParams({ ...Object.fromEntries(pq), msg_signature: "0".repeat(40) })}`, r.body))
    expect(bad.status).toBe(401)
  })
})
