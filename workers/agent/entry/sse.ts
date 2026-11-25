/**
 * SSE writer for the chat HTTP entry (docs/modules/chat.md 2.4「HTTP 接口约定 v1」):
 * `event: <type>\ndata: <single-line JSON>\n\n`, `: ping\n\n` keep-alive every 15 s.
 * Writes after the client went away are swallowed: a disconnect is NOT a cancel, the turn keeps
 * running and is persisted (chat.md 2.3).
 */
import type { ServerResponse } from "node:http"

import type { ChatStreamEvent } from "../loop/chat/events"

export const SSE_PING_INTERVAL_MS = 15_000

/** One event on the wire. The `type` goes to the event line; `data` carries the remaining fields. */
export function formatSseEvent(event: ChatStreamEvent): string {
  const { type, ...data } = event
  // JSON.stringify never emits raw newlines (they are escaped), so data stays on one line.
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

export const SSE_PING = ": ping\n\n"

/** The minimal surface of a writable HTTP response (ServerResponse in production, fakes in unit tests). */
export interface SseSink {
  write(chunk: string): boolean
  end(): void
  readonly writableEnded: boolean
  readonly destroyed: boolean
  on(event: "close", listener: () => void): unknown
}

export class SseWriter {
  private readonly sink: SseSink
  private ping: ReturnType<typeof setInterval> | null = null
  private closed = false
  private readonly closeListeners: Array<() => void> = []

  constructor(sink: SseSink, options: { pingIntervalMs?: number } = {}) {
    this.sink = sink
    sink.on("close", () => this.markClosed())
    const every = options.pingIntervalMs ?? SSE_PING_INTERVAL_MS
    if (every > 0) {
      this.ping = setInterval(() => this.writeRaw(SSE_PING), every)
      this.ping.unref?.()
    }
  }

  /** True once the client disconnected or the stream was ended. */
  get isClosed(): boolean {
    return this.closed || this.sink.destroyed || this.sink.writableEnded
  }

  /** Called once when the client goes away (not when we end the stream ourselves). */
  onDisconnect(listener: () => void): void {
    this.closeListeners.push(listener)
  }

  /** Never throws. */
  send(event: ChatStreamEvent): void {
    this.writeRaw(formatSseEvent(event))
  }

  end(): void {
    this.stopPing()
    if (this.isClosed) return
    this.closed = true
    try {
      this.sink.end()
    } catch {
      // the socket is already gone
    }
  }

  private writeRaw(chunk: string): void {
    if (this.isClosed) return
    try {
      this.sink.write(chunk)
    } catch {
      this.markClosed()
    }
  }

  private markClosed(): void {
    this.stopPing()
    if (this.closed) return
    this.closed = true
    for (const listener of this.closeListeners.splice(0)) {
      try {
        listener()
      } catch {
        // listeners must not break the turn
      }
    }
  }

  private stopPing(): void {
    if (this.ping) clearInterval(this.ping)
    this.ping = null
  }
}

/** Response headers for an SSE stream (no buffering by proxies, no caching). */
export function startSse(res: ServerResponse, extraHeaders: Record<string, string>): void {
  res.writeHead(200, {
    ...extraHeaders,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  })
  res.flushHeaders?.()
}
