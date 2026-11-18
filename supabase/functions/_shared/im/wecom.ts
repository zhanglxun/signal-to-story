// WeCom (企业微信) intelligent-bot "API mode" callback adapter + group-robot Markdown push.
// Protocol notes:
//  - Receive: callback JSON {msgid, aibotid, chatid?, chattype:"single"|"group", from:{userid}, msgtype:
//    text|mixed|image|file|video|voice|stream|event, text:{content}, mixed:{msg_item:[{msgtype,text}]}};
//    group callbacks only fire on @robot and the mention stays in text.content; msgid is the dedupe key.
//    [verified: developer.work.weixin.qq.com/document/path/100719]
//  - URL verification: GET msg_signature/timestamp/nonce/echostr, decrypt echostr, answer the plaintext msg
//    (no quotes/BOM/newline) within 1 s; receiveid is the empty string for smart robots.
//    [verified: path/101033 (partially: the signature formula page was not in the fetched text)]
//  - Encrypted reply envelope {encrypt, msgsignature, timestamp(seconds), nonce(from the callback URL)};
//    passive reply "stream" {msgtype:"stream", stream:{id, finish, content(Markdown, <=20480 bytes)}}.
//    [verified: path/101031 and path/101033]
//  - msg_signature = sha1(sort([token, timestamp, nonce, encrypt]).join("")); AES-256-CBC, key =
//    base64(EncodingAESKey + "="), IV = key[0..16], plaintext = random(16) + msg_len(4B big-endian) + msg +
//    receiveid, PKCS7 padded to 32 bytes.  [WeCom's long-standing public callback scheme; NOT re-verified
//    against the docs in this session]
//  - Group-robot push: POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=... with
//    {"msgtype":"markdown","markdown":{"content":"..."}}.  [from memory; UNVERIFIED this session]
//  - Markdown inside WeCom supports a limited tag set; untrusted text has <, >, backtick neutralised.
//  - Replay: signature timestamp older/newer than 5 minutes is rejected (our own policy).
import { Buffer } from "node:buffer"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

import { type ReviewNotice, PLATFORM_LABELS, roundsLabel, safeEqual, sanitizeForNotice, statusLabel } from "./shared.ts"

export type WecomConfig = {
  token: string
  encodingAesKey: string
  now?: number
  toleranceSeconds?: number
}

export type WecomQuery = { msg_signature?: string | null; timestamp?: string | null; nonce?: string | null; echostr?: string | null }

export const wecomSignature = (token: string, timestamp: string, nonce: string, encrypt: string) =>
  createHash("sha1").update([token, timestamp, nonce, encrypt].sort().join("")).digest("hex")

function aesKey(encodingAesKey: string): Buffer {
  const key = Buffer.from(`${encodingAesKey}=`, "base64")
  if (key.length !== 32) throw new Error("bad_encoding_aes_key")
  return key
}

export function wecomDecrypt(encrypt: string, encodingAesKey: string): { msg: string; receiveId: string } {
  const key = aesKey(encodingAesKey)
  const raw = Buffer.from(encrypt, "base64")
  if (raw.length < 32 || raw.length % 16 !== 0) throw new Error("bad_ciphertext")
  const d = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16))
  d.setAutoPadding(false)
  const out = Buffer.concat([d.update(raw), d.final()])
  const pad = out[out.length - 1]
  if (pad < 1 || pad > 32) throw new Error("bad_padding")
  const body = out.subarray(0, out.length - pad)
  const len = body.readUInt32BE(16)
  if (20 + len > body.length) throw new Error("bad_length")
  return { msg: body.subarray(20, 20 + len).toString("utf8"), receiveId: body.subarray(20 + len).toString("utf8") }
}

export function wecomEncrypt(msg: string, encodingAesKey: string, receiveId = "", random: Buffer = randomBytes(16)): string {
  const key = aesKey(encodingAesKey)
  const m = Buffer.from(msg, "utf8")
  const len = Buffer.alloc(4)
  len.writeUInt32BE(m.length)
  const plain = Buffer.concat([random, len, m, Buffer.from(receiveId, "utf8")])
  const pad = 32 - (plain.length % 32)
  const padded = Buffer.concat([plain, Buffer.alloc(pad, pad)])
  const c = createCipheriv("aes-256-cbc", key, key.subarray(0, 16))
  c.setAutoPadding(false)
  return Buffer.concat([c.update(padded), c.final()]).toString("base64")
}

type SigCheck = { ok: true } | { ok: false; reason: "missing_params" | "stale_timestamp" | "bad_signature" }

export function verifyWecomSignature(q: WecomQuery, encrypt: string, cfg: WecomConfig): SigCheck {
  if (!q.msg_signature || !q.timestamp || !q.nonce) return { ok: false, reason: "missing_params" }
  const ts = Number(q.timestamp)
  const now = (cfg.now ?? Date.now()) / 1000
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (cfg.toleranceSeconds ?? 300)) return { ok: false, reason: "stale_timestamp" }
  return safeEqual(wecomSignature(cfg.token, q.timestamp, q.nonce, encrypt), q.msg_signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "bad_signature" }
}

/** GET handshake. Returns the plaintext to echo back, or a rejection. */
export function handleWecomVerifyUrl(q: WecomQuery, cfg: WecomConfig): { ok: true; echo: string } | { ok: false; status: 400 | 401; reason: string } {
  if (!q.echostr) return { ok: false, status: 400, reason: "missing_echostr" }
  const sig = verifyWecomSignature(q, q.echostr, cfg)
  if (!sig.ok) return { ok: false, status: 401, reason: sig.reason }
  try {
    const { msg, receiveId } = wecomDecrypt(q.echostr, cfg.encodingAesKey)
    if (receiveId !== "") return { ok: false, status: 401, reason: "receiveid_mismatch" }
    return { ok: true, echo: msg }
  } catch {
    return { ok: false, status: 401, reason: "decrypt_failed" }
  }
}

export type WecomInbound =
  | { kind: "message"; messageId: string; chatId: string; chatType: string; userId: string; messageType: string; text: string }
  | { kind: "ignored"; reason: string }
  | { kind: "rejected"; status: 400 | 401; reason: string }

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown) => (typeof v === "string" ? v : "")

export function parseWecomRequest(rawBody: string, q: WecomQuery, cfg: WecomConfig): WecomInbound & { plain?: Json } {
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return { kind: "rejected", status: 400, reason: "invalid_json" }
  }
  if (!isObj(body) || typeof body.encrypt !== "string") return { kind: "rejected", status: 400, reason: "invalid_json" }
  const sig = verifyWecomSignature(q, body.encrypt, cfg)
  if (!sig.ok) return { kind: "rejected", status: 401, reason: sig.reason }
  let msg: Json
  try {
    const { msg: plain, receiveId } = wecomDecrypt(body.encrypt, cfg.encodingAesKey)
    if (receiveId !== "") return { kind: "rejected", status: 401, reason: "receiveid_mismatch" }
    const parsed: unknown = JSON.parse(plain)
    if (!isObj(parsed)) return { kind: "rejected", status: 400, reason: "invalid_json" }
    msg = parsed
  } catch {
    return { kind: "rejected", status: 401, reason: "decrypt_failed" }
  }
  const msgType = str(msg.msgtype)
  if (msgType === "event" || msgType === "stream") return { kind: "ignored", reason: `${msgType}_callback` }
  const messageId = str(msg.msgid)
  if (!messageId) return { kind: "rejected", status: 400, reason: "missing_msgid" }
  let text = ""
  if (msgType === "text" && isObj(msg.text)) text = str(msg.text.content)
  else if (msgType === "mixed" && isObj(msg.mixed) && Array.isArray(msg.mixed.msg_item)) {
    text = msg.mixed.msg_item
      .map((it) => (isObj(it) && it.msgtype === "text" && isObj(it.text) ? str(it.text.content) : ""))
      .filter(Boolean)
      .join("\n")
  }
  // The @robot mention stays inside the text of group messages: drop leading mentions.
  text = text.replace(/^(\s*@\S+\s*)+/, "").trim()
  return {
    kind: "message",
    messageId,
    chatId: str(msg.chatid),
    chatType: str(msg.chattype),
    userId: isObj(msg.from) ? str(msg.from.userid) : "",
    messageType: msgType,
    text,
  }
}

/** Passive reply: encrypted stream message carrying Markdown, finished in one shot. */
export function buildWecomReply(markdown: string, cfg: WecomConfig, q: { nonce: string }, streamId: string, opts?: { now?: number; random?: Buffer }) {
  const plain = JSON.stringify({ msgtype: "stream", stream: { id: streamId, finish: true, content: markdown.slice(0, 6000) } })
  const encrypt = wecomEncrypt(plain, cfg.encodingAesKey, "", opts?.random)
  const timestamp = Math.floor((opts?.now ?? Date.now()) / 1000)
  return { encrypt, msgsignature: wecomSignature(cfg.token, String(timestamp), q.nonce, encrypt), timestamp, nonce: q.nonce }
}

const neutralise = (s: string) => s.replace(/</g, "＜").replace(/>/g, "＞").replace(/`/g, "'")

/** Markdown review notice. Contains only links to the console; WeCom cannot approve. */
export function buildWecomReviewMarkdown(n: ReviewNotice): string {
  const platform = n.platform ? (PLATFORM_LABELS[n.platform] ?? n.platform) : "稿件"
  const rounds = roundsLabel(n)
  return [
    `**${statusLabel(n.status)}**：${neutralise(sanitizeForNotice(n.title, 40) || "未命名稿件")}`,
    rounds ? `平台：${platform}\u3000评估轮数：${rounds}` : `平台：${platform}`,
    ...(n.summary ? [neutralise(sanitizeForNotice(n.summary, 300))] : []),
    `[查看并审核](${n.reviewUrl})\u3000[打开任务](${n.taskUrl})`,
    "审核与发布须在控制台由登录成员对具体版本操作，IM 内不会批准。",
  ].join("\n")
}

export type WecomFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>

export async function sendWecomGroupMarkdown(webhookUrl: string, content: string, fetchFn: WecomFetch): Promise<void> {
  const res = await fetchFn(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: { content: content.slice(0, 4000) } }),
  })
  if (!res.ok) throw new Error(`wecom_push_${res.status}`)
}
