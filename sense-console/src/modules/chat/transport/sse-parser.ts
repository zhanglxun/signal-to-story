import type { ChatStreamEvent } from "@/modules/chat/types"

const VALID_EVENT_TYPES = new Set<ChatStreamEvent["type"]>([
  "turn_start",
  "reasoning_delta",
  "text_delta",
  "plan_update",
  "tool_start",
  "tool_end",
  "permission_request",
  "usage",
  "error",
  "done",
])

/**
 * Parse a single SSE block (`event: ...\ndata: ...\n\n`).
 * Comment lines (`:...`), empty blocks, and malformed frames are ignored safely.
 */
export function parseSseBlock(rawBlock: string): ChatStreamEvent | null {
  const lines = rawBlock.split(/\r?\n/)
  let eventName = ""
  const dataLines: string[] = []

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)

    if (field === "event") {
      eventName = value.trim()
    } else if (field === "data") {
      dataLines.push(value)
    }
  }

  if (dataLines.length === 0) return null
  const jsonText = dataLines.join("\n").trim()
  if (!jsonText) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null

  const obj = parsed as Record<string, unknown>
  const resolvedType = (eventName || (typeof obj.type === "string" ? obj.type : "")) as ChatStreamEvent["type"]
  if (!VALID_EVENT_TYPES.has(resolvedType)) return null

  return {
    ...obj,
    type: resolvedType,
  } as ChatStreamEvent
}

/**
 * Incremental `ReadableStream<Uint8Array>` SSE parser supporting chunk boundaries,
 * multi-event chunks, CRLF/LF delimiters, `: ping` keepalive comments, and AbortSignal.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<ChatStreamEvent, void, void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  let pendingCr = false

  const appendNormalized = (chunkText: string) => {
    if (!chunkText) return
    let text = chunkText
    if (pendingCr) {
      pendingCr = false
      if (text.startsWith("\n")) {
        text = text.slice(1)
      }
      buffer += "\n"
      if (!text) return
    }
    if (text.endsWith("\r")) {
      pendingCr = true
      text = text.slice(0, -1)
    }
    if (text) {
      buffer += text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    }
  }

  const abortError = () => new DOMException("Aborted", "AbortError")
  const onAbort = () => {
    void reader.cancel().catch(() => undefined)
  }
  if (signal?.aborted) {
    onAbort()
    throw abortError()
  }
  signal?.addEventListener("abort", onAbort, { once: true })

  try {
    while (true) {
      if (signal?.aborted) throw abortError()
      const { value, done } = await reader.read()
      if (signal?.aborted) throw abortError()
      if (done) break

      appendNormalized(decoder.decode(value, { stream: true }))

      let sepIndex = buffer.indexOf("\n\n")
      while (sepIndex !== -1) {
        const block = buffer.slice(0, sepIndex)
        buffer = buffer.slice(sepIndex + 2)
        const event = parseSseBlock(block)
        if (event) yield event
        sepIndex = buffer.indexOf("\n\n")
      }
    }
    if (signal?.aborted) throw abortError()

    appendNormalized(decoder.decode())
    if (pendingCr) {
      buffer += "\n"
      pendingCr = false
    }
    if (buffer.trim()) {
      for (const block of buffer.split("\n\n")) {
        const event = parseSseBlock(block)
        if (event) yield event
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort)
    try {
      reader.releaseLock()
    } catch {
      // Reader may already be released after cancel.
    }
  }
}
