// Runtime-neutral request handler for /im-webhook/<feishu|wecom>/<connection_id>.
// The Deno Edge Function (supabase/functions/im-webhook/index.ts) only injects env, the RPC caller and fetch.
import { type FeishuConfig, type FeishuSender, parseFeishuRequest } from "./feishu.ts"
import {
  buildReceiptText,
  type CaptureResult,
  HINT_EMPTY,
  HINT_FOLLOWUP,
  HINT_REVIEW,
  HINT_UNSUPPORTED,
  idempotencyKey,
  type ImCaptureInput,
  type ImChannel,
  parseIntent,
} from "./shared.ts"
import { buildWecomReply, handleWecomVerifyUrl, parseWecomRequest, type WecomConfig } from "./wecom.ts"

export type RpcResult = { data: unknown; error: { code?: string; message: string } | null }

export type ImHandlerDeps = {
  feishu: FeishuConfig | null
  wecom: WecomConfig | null
  feishuSender: FeishuSender | null
  consoleBaseUrl: string
  /** Calls public.im_quick_capture(connection_id, reply_target, input) with the service role. */
  capture: (connectionId: string, replyTarget: string | null, input: ImCaptureInput) => Promise<RpcResult>
  /** Keep a promise alive after the response was returned (EdgeRuntime.waitUntil). Must never throw. */
  background: (work: Promise<unknown>) => void
  newStreamId?: () => string
  log?: (event: string, fields: Record<string, unknown>) => void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" }
const MAX_BODY = 64_000

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
const plain = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })

export function parseRoute(url: URL): { channel: ImChannel; connectionId: string } | null {
  const parts = url.pathname.split("/").filter(Boolean)
  const i = parts.lastIndexOf("im-webhook")
  const [channel, connectionId] = parts.slice(i + 1)
  if (i < 0 || (channel !== "feishu" && channel !== "wecom") || !connectionId || !UUID.test(connectionId)) return null
  return { channel, connectionId: connectionId.toLowerCase() }
}

type Outcome = { status: 200; reply: string } | { status: 401 | 503 }

export function createImHandler(deps: ImHandlerDeps) {
  const log = deps.log ?? (() => {})

  async function process(
    channel: ImChannel,
    connectionId: string,
    msg: { id: string; replyTarget: string; messageType: string; text: string; urls: string[] }
  ): Promise<Outcome> {
    if (msg.messageType !== "text" && msg.messageType !== "post" && msg.messageType !== "mixed") return { status: 200, reply: HINT_UNSUPPORTED }
    const intent = parseIntent(msg.text, msg.urls)
    if (intent.kind === "empty") return { status: 200, reply: HINT_EMPTY }
    if (intent.kind === "followup") return { status: 200, reply: HINT_FOLLOWUP }
    if (intent.kind === "review_command") return { status: 200, reply: HINT_REVIEW }
    const input: ImCaptureInput = { ...intent.input, external_id: idempotencyKey(channel, msg.id) }
    const { data, error } = await deps.capture(connectionId, msg.replyTarget || null, input)
    if (error) {
      const m = error.message
      if (m.includes("invalid_connection")) return { status: 401 }
      if (m.includes("rate_limited")) return { status: 200, reply: "收录过于频繁，请稍后再试。" }
      if (m.includes("invalid_input")) return { status: 200, reply: HINT_EMPTY }
      if (m.includes("idempotency_conflict")) return { status: 200, reply: "" }
      log("capture_failed", { channel, code: error.code })
      return { status: 503 } // transient: let the platform retry; the platform message id dedupes
    }
    const result = (data ?? {}) as CaptureResult
    // Duplicate delivery: already captured and already answered once -> no second receipt.
    if (result.duplicate) return { status: 200, reply: "" }
    return { status: 200, reply: buildReceiptText(result, deps.consoleBaseUrl) }
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const route = parseRoute(url)
    if (!route) return json({ error: "not_found" }, 404)

    if (route.channel === "wecom") {
      const cfg = deps.wecom
      if (!cfg) return json({ error: "channel_not_configured" }, 503)
      const q = {
        msg_signature: url.searchParams.get("msg_signature"),
        timestamp: url.searchParams.get("timestamp"),
        nonce: url.searchParams.get("nonce"),
        echostr: url.searchParams.get("echostr"),
      }
      if (req.method === "GET") {
        const r = handleWecomVerifyUrl(q, cfg)
        return r.ok ? plain(r.echo) : json({ error: r.reason }, r.status)
      }
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      const raw = await readBody(req)
      if (raw === null) return json({ error: "body_too_large" }, 413)
      const inbound = parseWecomRequest(raw, q, cfg)
      if (inbound.kind === "rejected") return json({ error: inbound.reason }, inbound.status)
      if (inbound.kind === "ignored") return plain("")
      const out = await process("wecom", route.connectionId, {
        id: inbound.messageId,
        replyTarget: inbound.chatId || inbound.userId,
        messageType: inbound.messageType,
        text: inbound.text,
        urls: [],
      })
      if (out.status !== 200) return json({ error: out.status === 401 ? "invalid_connection" : "temporarily_unavailable" }, out.status)
      if (!out.reply) return plain("")
      return json(buildWecomReply(out.reply, cfg, { nonce: q.nonce ?? "" }, deps.newStreamId?.() ?? crypto.randomUUID()))
    }

    // Feishu
    const cfg = deps.feishu
    if (!cfg) return json({ error: "channel_not_configured" }, 503)
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405)
    const raw = await readBody(req)
    if (raw === null) return json({ error: "body_too_large" }, 413)
    const inbound = parseFeishuRequest(raw, req.headers, cfg)
    if (inbound.kind === "rejected") return json({ error: inbound.reason }, inbound.status)
    if (inbound.kind === "challenge" || inbound.kind === "card_action") return json(inbound.response)
    if (inbound.kind === "ignored") return json({})
    const out = await process("feishu", route.connectionId, {
      id: inbound.messageId || inbound.eventId,
      replyTarget: inbound.chatId,
      messageType: inbound.messageType,
      text: inbound.text,
      urls: inbound.urls,
    })
    if (out.status !== 200) return json({ error: out.status === 401 ? "invalid_connection" : "temporarily_unavailable" }, out.status)
    const sender = deps.feishuSender
    if (out.reply && sender) {
      // Receipt delivery is independent of capture success: a failure here is logged, never re-captured.
      deps.background(
        sender.replyText(inbound.messageId, out.reply).catch((e: unknown) => log("receipt_failed", { channel: "feishu", error: String(e) }))
      )
    }
    return json({})
  }
}

async function readBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let off = 0
  for (const c of chunks) {
    bytes.set(c, off)
    off += c.length
  }
  return new TextDecoder().decode(bytes)
}
