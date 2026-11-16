/* eslint-disable no-control-regex */
// Pure, runtime-neutral IM helpers (no Deno / browser APIs). Shared by the im-webhook Edge Function,
// the worker notifier and vitest. Message text is ALWAYS untrusted data: it is only ever stored as a
// signal/note and never interpreted as an instruction to approve, publish or delete anything.
import { Buffer } from "node:buffer"
import { createHash, timingSafeEqual } from "node:crypto"

export type ImChannel = "feishu" | "wecom"

export const PLATFORM_ALIASES: Array<[RegExp, string]> = [
  [/视频号/, "wechat_channels"],
  [/公众号/, "wechat_official"],
  [/小红书/, "xiaohongshu"],
  [/抖音/, "douyin"],
  [/(^|[^A-Za-z0-9])(x|twitter)([^A-Za-z0-9]|$)|推特/i, "x"],
  [/youtube|油管/i, "youtube"],
  [/reddit/i, "reddit"],
]

export const PLATFORM_LABELS: Record<string, string> = {
  master: "母稿",
  wechat_channels: "视频号",
  wechat_official: "公众号",
  xiaohongshu: "小红书",
  douyin: "抖音",
  x: "X",
  youtube: "YouTube",
  reddit: "Reddit",
}

/** Payload accepted by quick_capture_for_connection (same shape as intake-gateway/contract.ts). */
export type ImCaptureInput = {
  version: 1
  intent: "capture" | "auto_draft"
  external_id: string
  text: string
  title: string
  url: string
  angle: string
  platforms?: string[]
}

export type ParsedIntent =
  | { kind: "capture"; input: Omit<ImCaptureInput, "external_id"> }
  | { kind: "auto_draft"; input: Omit<ImCaptureInput, "external_id"> }
  | { kind: "followup" } // "补充到 #任务号" / "改一下 #任务号": not supported over IM yet
  | { kind: "review_command" } // "通过" / "退回" ...: never executed from IM
  | { kind: "empty" }

const AUTO_PREFIX = /^(出稿|写一篇|做这个|从这个角度写|帮我写|生成稿件|写成)\s*[:：,，]?\s*/
const SAVE_PREFIX = /^(收藏一下|收藏|存一下|记一下|capture_only)\s*[:：,，]?\s*/i
const FOLLOWUP = /^(补充到|改一下)\s*#?\S*/
const REVIEW = /^(通过并发布|通过暂存|通过|批准|发布|退回|驳回)(\s|$|#|[:：，,])/

const URL_RE = /https?:\/\/[^\s<>"'`，。！？；、）】」』》]+/gi
const TRAILING = /[.,;:!?)\]}>，。；：！？、）】」』》"'”’]+$/

export function extractUrls(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.match(URL_RE) ?? []) {
    const u = m.replace(TRAILING, "")
    try {
      const p = new URL(u)
      if ((p.protocol === "http:" || p.protocol === "https:") && !p.username && !p.password && u.length <= 512) seen.add(u)
    } catch {
      /* not a URL */
    }
  }
  return [...seen]
}

export function detectPlatforms(text: string): string[] {
  const out: string[] = []
  for (const [re, key] of PLATFORM_ALIASES) if (re.test(text) && !out.includes(key)) out.push(key)
  return out
}

const clip = (s: string, max: number) => Array.from(s).slice(0, max).join("")

/**
 * Intent convention (master plan P3/P4): bare link or "收藏" => capture only;
 * explicit "出稿 / 写一篇 / 做这个 / 写成 X 和公众号 / 从这个角度写" => auto_draft.
 * `extraUrls` are links found in structured content (e.g. Feishu rich-text `a` tags).
 */
export function parseIntent(rawText: string, extraUrls: string[] = []): ParsedIntent {
  const text = rawText.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()
  if (!text && extraUrls.length === 0) return { kind: "empty" }
  if (FOLLOWUP.test(text)) return { kind: "followup" }
  if (text.length <= 40 && extractUrls(text).length === 0 && REVIEW.test(text + " ")) return { kind: "review_command" }
  let intent: "capture" | "auto_draft" = "capture"
  let body = text
  const auto = AUTO_PREFIX.exec(body)
  if (auto) {
    intent = "auto_draft"
    body = body.slice(auto[0].length)
  } else {
    const save = SAVE_PREFIX.exec(body)
    if (save) body = body.slice(save[0].length)
  }
  const urls = [...new Set([...extractUrls(body), ...extraUrls.flatMap((u) => extractUrls(u))])]
  const url = urls[0] ?? ""
  const withoutUrls = urls.reduce((acc, u) => acc.split(u).join(" "), body).replace(/\s+/g, " ").trim()
  const noteText = clip(body.trim() || url, 4000)
  if (!noteText) return { kind: "empty" }
  const title =
    clip(withoutUrls, 64) || clip(url.replace(/^https?:\/\//i, ""), 64) || "IM 速记"
  const base = { version: 1 as const, text: noteText, title, url, angle: "" }
  if (intent === "auto_draft") {
    return { kind: "auto_draft", input: { ...base, intent, platforms: detectPlatforms(withoutUrls) } }
  }
  return { kind: "capture", input: { ...base, intent } }
}

/** external_id for the capture RPC (<= 128 chars). Dedupes on the platform's own message id. */
export function idempotencyKey(channel: ImChannel, platformMessageId: string): string {
  const id = `${channel}:${platformMessageId}`
  return id.length <= 128 ? id : `${channel}:sha256:${sha256Hex(platformMessageId)}`
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export type CaptureResult = {
  capture_id?: string
  receipt_id?: string
  intent?: string
  duplicate?: boolean
  selection_id?: number
  project_id?: string | null
  documents?: Array<{ platform: string; document_id: string; job_id: string }>
  topic_path?: string
  project_path?: string | null
}

export function consoleUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`
}

/** Plain-text receipt: what was captured, whether auto-drafting started, and where to look. */
export function buildReceiptText(result: CaptureResult, consoleBase: string): string {
  const topic = consoleUrl(consoleBase, result.topic_path ?? `/topics/${result.selection_id ?? ""}`)
  const docs = result.documents ?? []
  if (docs.length > 0) {
    const labels = docs.map((d) => PLATFORM_LABELS[d.platform] ?? d.platform).join("、")
    const project = result.project_path ? consoleUrl(consoleBase, result.project_path) : topic
    return `已收录并开始自动出稿（${labels}，共 ${docs.length} 篇，生成后将进入待审核，不会自动发布）。\n项目：${project}\n任务：${consoleUrl(consoleBase, "/tasks")}`
  }
  return `已收录到选题库（仅收录，未自动出稿）。如需出稿，请发送「出稿 + 链接/想法」，或在控制台操作。\n选题：${topic}`
}

export const HINT_FOLLOWUP = "暂不支持在 IM 中补充或修改任务，请在控制台任务页追加一轮。"
export const HINT_REVIEW =
  "审核与发布只能由已登录控制台的成员在页面中对具体版本操作，IM 不执行批准。收到待审卡片后请点击「查看并审核」。"
export const HINT_UNSUPPORTED = "暂仅支持文字与链接消息。"
export const HINT_EMPTY = "没有发现可收录的内容。发送链接或一句话想法即可；以「出稿」开头可自动出稿到待审。"
export const HINT_FAILED = "收录暂时失败，稍后会自动重试，或请直接在控制台速记。"

/** Information shown on a review notification. All free text is untrusted and length-bounded. */
export type ReviewNotice = {
  jobId: string
  status: "pending_review" | "blocked_needs_human"
  title: string
  platform?: string | null
  rounds: number
  maxRounds?: number
  summary?: string
  taskUrl: string
  reviewUrl: string
}

/** Strip control characters and cap length for any untrusted text placed into a card or markdown. */
export function sanitizeForNotice(text: string | null | undefined, max: number): string {
  return clip((text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim(), max)
}

export const statusLabel = (s: ReviewNotice["status"]) => (s === "pending_review" ? "待审核" : "需要人工处理")
