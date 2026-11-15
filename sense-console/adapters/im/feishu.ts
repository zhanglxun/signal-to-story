// Feishu (Lark) custom-app bot adapter: event subscription (HTTP callback).
// Protocol notes (checked against open.feishu.cn docs on 2026-11-15 unless marked UNVERIFIED):
//  - Encrypted body: {"encrypt": base64}. AES-256-CBC, key = SHA256(EncryptKey), IV = first 16 bytes of the
//    decoded payload, ciphertext = rest, PKCS7 padding.   [verified: encrypt-key-encryption-configuration-case]
//  - Signature: sha256_hex(timestamp + nonce + EncryptKey + rawBody) compared with X-Lark-Signature, headers
//    X-Lark-Request-Timestamp / X-Lark-Request-Nonce; must use the raw body.   [verified: same page]
//  - url_verification handshake: {"challenge","token","type":"url_verification"} -> respond {"challenge"}.
//    [from memory of the public docs; UNVERIFIED this session]
//  - Event v2 envelope {schema:"2.0", header:{event_id, token, event_type, ...}, event:{...}} with
//    im.message.receive_v1 (message.message_id/chat_id/chat_type/message_type/content(JSON string)/mentions,
//    sender.sender_type/sender_id.open_id), post (rich text) content shape, card.action.trigger response
//    {"toast":{...}}, send-message / reply / tenant_access_token endpoints and card JSON 1.0:
//    UNVERIFIED against the docs in this session (pages are client-rendered); fixtures follow the public structure.
//  - Replay: we additionally reject signature timestamps older/newer than 5 minutes (our own policy).
import { Buffer } from "node:buffer"
import { createCipheriv, createDecipheriv, createHash } from "node:crypto"

import {
  type ReviewNotice,
  safeEqual,
  sanitizeForNotice,
  sha256Hex,
  statusLabel,
  PLATFORM_LABELS,
} from "./shared.ts"

export type FeishuConfig = {
  verificationToken: string
  /** Optional in Feishu; when set, bodies MUST be encrypted and signed. */
  encryptKey?: string
  /** Epoch ms, injectable for tests. */
  now?: number
  toleranceSeconds?: number
}

export function decryptFeishu(encrypt: string, encryptKey: string): string {
  const raw = Buffer.from(encrypt, "base64")
  if (raw.length < 32 || (raw.length - 16) % 16 !== 0) throw new Error("bad_ciphertext")
  const key = createHash("sha256").update(encryptKey).digest()
  const decipher = createDecipheriv("aes-256-cbc", key, raw.subarray(0, 16))
  decipher.setAutoPadding(false)
  const out = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()])
  const pad = out[out.length - 1]
  if (pad < 1 || pad > 16) throw new Error("bad_padding")
  return out.subarray(0, out.length - pad).toString("utf8")
}

/** Test/support helper: the inverse of decryptFeishu. */
export function encryptFeishu(plain: string, encryptKey: string, iv: Buffer): string {
  const key = createHash("sha256").update(encryptKey).digest()
  const c = createCipheriv("aes-256-cbc", key, iv)
  return Buffer.concat([iv, c.update(plain, "utf8"), c.final()]).toString("base64")
}

export function feishuSignature(timestamp: string, nonce: string, encryptKey: string, rawBody: string): string {
  return sha256Hex(timestamp + nonce + encryptKey + rawBody)
}

export type FeishuHeaders = { get(name: string): string | null }

export function verifyFeishuSignature(
  headers: FeishuHeaders,
  rawBody: string,
  cfg: Pick<FeishuConfig, "encryptKey" | "now" | "toleranceSeconds">
): { ok: true } | { ok: false; reason: "missing_headers" | "stale_timestamp" | "bad_signature" } {
  const timestamp = headers.get("X-Lark-Request-Timestamp")
  const nonce = headers.get("X-Lark-Request-Nonce")
  const signature = headers.get("X-Lark-Signature")
  if (!timestamp || !nonce || !signature || !cfg.encryptKey) return { ok: false, reason: "missing_headers" }
  const ts = Number(timestamp)
  const now = (cfg.now ?? Date.now()) / 1000
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (cfg.toleranceSeconds ?? 300)) return { ok: false, reason: "stale_timestamp" }
  return safeEqual(feishuSignature(timestamp, nonce, cfg.encryptKey, rawBody), signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "bad_signature" }
}

export type FeishuInbound =
  | { kind: "challenge"; response: { challenge: string } }
  | {
      kind: "message"
      eventId: string
      messageId: string
      chatId: string
      chatType: string
      senderOpenId: string
      messageType: string
      text: string
      urls: string[]
    }
  | { kind: "card_action"; response: Record<string, unknown> }
  | { kind: "ignored"; reason: string }
  | { kind: "rejected"; status: 400 | 401; reason: string }

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown) => (typeof v === "string" ? v : "")

/** Extract text and links from a rich-text (post) body: {title, content:[[{tag,text|href}]]} or {zh_cn:{...}}. */
export function extractPost(content: unknown): { text: string; urls: string[] } {
  let body: unknown = content
  if (isObj(content) && !Array.isArray(content.content)) {
    body = Object.values(content).find((v) => isObj(v) && Array.isArray(v.content)) ?? content
  }
  const lines: string[] = []
  const urls: string[] = []
  if (isObj(body)) {
    if (str(body.title)) lines.push(str(body.title))
    if (Array.isArray(body.content)) {
      for (const para of body.content) {
        if (!Array.isArray(para)) continue
        let line = ""
        for (const el of para) {
          if (!isObj(el)) continue
          if (el.tag === "text") line += str(el.text)
          else if (el.tag === "a") {
            if (str(el.href)) urls.push(str(el.href))
            line += str(el.text) || str(el.href)
          }
        }
        lines.push(line)
      }
    }
  }
  return { text: lines.join("\n").trim(), urls }
}

export function parseFeishuRequest(rawBody: string, headers: FeishuHeaders, cfg: FeishuConfig): FeishuInbound {
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return { kind: "rejected", status: 400, reason: "invalid_json" }
  }
  if (!isObj(body)) return { kind: "rejected", status: 400, reason: "invalid_json" }
  let payload: Json = body
  if (cfg.encryptKey) {
    // When an Encrypt Key is configured an unencrypted body is a downgrade attempt.
    if (typeof body.encrypt !== "string") return { kind: "rejected", status: 401, reason: "encryption_required" }
    try {
      const inner: unknown = JSON.parse(decryptFeishu(body.encrypt, cfg.encryptKey))
      if (!isObj(inner)) return { kind: "rejected", status: 400, reason: "invalid_json" }
      payload = inner
    } catch {
      return { kind: "rejected", status: 401, reason: "decrypt_failed" }
    }
    if (payload.type !== "url_verification") {
      const sig = verifyFeishuSignature(headers, rawBody, cfg)
      if (!sig.ok) return { kind: "rejected", status: 401, reason: sig.reason }
    }
  } else if ("encrypt" in body) {
    return { kind: "rejected", status: 401, reason: "unexpected_encryption" }
  }

  if (payload.type === "url_verification") {
    if (!safeEqual(str(payload.token), cfg.verificationToken) || !str(payload.challenge))
      return { kind: "rejected", status: 401, reason: "bad_token" }
    return { kind: "challenge", response: { challenge: str(payload.challenge) } }
  }

  const header = isObj(payload.header) ? payload.header : null
  if (!header || !safeEqual(str(header.token), cfg.verificationToken)) return { kind: "rejected", status: 401, reason: "bad_token" }
  const eventType = str(header.event_type)
  const event = isObj(payload.event) ? payload.event : {}

  if (eventType === "card.action.trigger") {
    // Cards only carry link buttons. Even if a callback arrives it is acknowledged and NEVER acted on.
    return { kind: "card_action", response: { toast: { type: "info", content: "请在控制台中审核具体版本" } } }
  }
  if (eventType !== "im.message.receive_v1") return { kind: "ignored", reason: "unsupported_event_type" }

  const message = isObj(event.message) ? event.message : null
  const sender = isObj(event.sender) ? event.sender : {}
  if (!message || !str(message.message_id) || !str(message.chat_id)) return { kind: "rejected", status: 400, reason: "invalid_message" }
  if (str(sender.sender_type) && sender.sender_type !== "user") return { kind: "ignored", reason: "non_user_sender" }
  const senderId = isObj(sender.sender_id) ? str(sender.sender_id.open_id) : ""
  const messageType = str(message.message_type)
  let text = ""
  let urls: string[] = []
  let content: unknown = null
  try {
    content = JSON.parse(str(message.content))
  } catch {
    content = null
  }
  if (messageType === "text" && isObj(content)) {
    text = str(content.text)
    const mentions = Array.isArray(message.mentions) ? message.mentions : []
    for (const m of mentions) if (isObj(m) && str(m.key)) text = text.split(str(m.key)).join("")
    text = text.trim()
  } else if (messageType === "post") {
    const post = extractPost(content)
    text = post.text
    urls = post.urls
  }
  return {
    kind: "message",
    eventId: str(header.event_id),
    messageId: str(message.message_id),
    chatId: str(message.chat_id),
    chatType: str(message.chat_type),
    senderOpenId: senderId,
    messageType,
    text,
    urls,
  }
}

// ---- Outbound -------------------------------------------------------------------------------------

export const feishuTextContent = (text: string) => JSON.stringify({ text })

/** Interactive card (JSON 1.0): two LINK buttons only; Feishu never carries an approval action. */
export function buildFeishuReviewCard(n: ReviewNotice): Record<string, unknown> {
  const platform = n.platform ? (PLATFORM_LABELS[n.platform] ?? n.platform) : "稿件"
  const rounds = n.maxRounds ? `${n.rounds}/${n.maxRounds}` : String(n.rounds)
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `${statusLabel(n.status)}：${sanitizeForNotice(n.title, 40) || "未命名稿件"}` },
      template: n.status === "pending_review" ? "blue" : "orange",
    },
    elements: [
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "plain_text", content: `平台：${platform}` } },
          { is_short: true, text: { tag: "plain_text", content: `评估轮数：${rounds}` } },
        ],
      },
      ...(n.summary ? [{ tag: "div", text: { tag: "plain_text", content: sanitizeForNotice(n.summary, 300) } }] : []),
      { tag: "note", elements: [{ tag: "plain_text", content: "审核与发布须在控制台由登录成员对具体版本操作；IM 内不会批准。" }] },
      {
        tag: "action",
        actions: [
          { tag: "button", type: "primary", text: { tag: "plain_text", content: "查看并审核" }, url: n.reviewUrl },
          { tag: "button", type: "default", text: { tag: "plain_text", content: "打开任务" }, url: n.taskUrl },
        ],
      },
    ],
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export type FeishuSender = {
  replyText(messageId: string, text: string): Promise<void>
  sendCard(chatId: string, card: Record<string, unknown>): Promise<void>
}

/** Feishu OpenAPI sender (tenant_access_token, cached). `fetch` is injected; never called in tests against real hosts. */
export function createFeishuSender(opts: { appId: string; appSecret: string; fetch: FetchLike; baseUrl?: string; now?: () => number }): FeishuSender {
  const base = opts.baseUrl ?? "https://open.feishu.cn"
  const now = opts.now ?? Date.now
  let token: { value: string; expiresAt: number } | null = null
  const post = async (path: string, headers: Record<string, string>, body: unknown) => {
    const res = await opts.fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number }
    if (!res.ok || (typeof data.code === "number" && data.code !== 0)) throw new Error(`feishu_api_${res.status}_${data.code ?? ""}`)
    return data
  }
  const auth = async () => {
    if (token && token.expiresAt > now() + 60_000) return token.value
    const data = await post("/open-apis/auth/v3/tenant_access_token/internal", {}, { app_id: opts.appId, app_secret: opts.appSecret })
    if (!data.tenant_access_token) throw new Error("feishu_no_token")
    token = { value: data.tenant_access_token, expiresAt: now() + (data.expire ?? 3600) * 1000 }
    return token.value
  }
  return {
    async replyText(messageId, text) {
      await post(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`, { Authorization: `Bearer ${await auth()}` }, {
        msg_type: "text",
        content: feishuTextContent(text),
      })
    },
    async sendCard(chatId, card) {
      await post("/open-apis/im/v1/messages?receive_id_type=chat_id", { Authorization: `Bearer ${await auth()}` }, {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      })
    },
  }
}
