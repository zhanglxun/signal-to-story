import type { Platform } from "@/contracts/content"

export type QuickCaptureIntent = "capture_only" | "auto_draft"

export interface ParsedCaptureInput {
  kind: "empty" | "url" | "text" | "url_with_note"
  url: string | null
  note: string | null
}

export interface QuickCaptureRequest {
  organizationId: string
  url: string | null
  note: string | null
  intent: QuickCaptureIntent
  platforms: Platform[]
  idempotencyKey: string
}

export interface QuickCaptureResult {
  captureId: string
  intent: QuickCaptureIntent
  duplicate: boolean
  signalId: number
  selectionId: number
  projectId: string | null
  documents: Array<{ platform: string; documentId: string; jobId: string }>
  topicPath: string
  projectPath: string | null
}

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？、；：）】」]+/i

/**
 * Split pasted text into (first http(s) link, remaining note). Pure; mirrored by the
 * database validation in quick_capture (which is authoritative).
 */
export function parseCaptureInput(raw: string): ParsedCaptureInput {
  const text = raw.trim()
  if (!text) return { kind: "empty", url: null, note: null }
  const match = text.match(URL_PATTERN)
  let url: string | null = null
  if (match) {
    const candidate = match[0].replace(/[).,;!?]+$/, "")
    try {
      const parsed = new URL(candidate)
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password && candidate.length <= 512) url = candidate
    } catch {
      url = null
    }
  }
  const note = (url ? text.replace(match![0], " ") : text).replace(/\s+/g, " ").trim() || null
  if (url && note) return { kind: "url_with_note", url, note }
  if (url) return { kind: "url", url, note: null }
  return { kind: "text", url: null, note }
}

export function newCaptureIdempotencyKey(): string {
  return `web-${globalThis.crypto.randomUUID()}`
}

export function mapQuickCaptureResult(row: Record<string, unknown>): QuickCaptureResult {
  const docs = Array.isArray(row.documents) ? (row.documents as Array<Record<string, unknown>>) : []
  return {
    captureId: String(row.capture_id),
    intent: row.intent as QuickCaptureIntent,
    duplicate: Boolean(row.duplicate),
    signalId: Number(row.signal_id),
    selectionId: Number(row.selection_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    documents: docs.map((d) => ({ platform: String(d.platform), documentId: String(d.document_id), jobId: String(d.job_id) })),
    topicPath: String(row.topic_path),
    projectPath: row.project_path == null ? null : String(row.project_path),
  }
}

/** True for Cmd+K (macOS) / Ctrl+K (others). */
export function isQuickCaptureShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
}
