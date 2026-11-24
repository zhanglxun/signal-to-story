import { describe, expect, it } from "vitest"

import { parseSseBlock, parseSseStream } from "@/modules/chat/transport/sse-parser"
import type { ChatStreamEvent } from "@/modules/chat/types"

function streamFromChunks(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk)
      }
      controller.close()
    },
  })
}

async function collectEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const ev of parseSseStream(stream, signal)) {
    events.push(ev)
  }
  return events
}

describe("parseSseStream", () => {
  it("handles split chunks across UTF-8 multibyte chars and frame boundaries", async () => {
    const encoder = new TextEncoder()
    const payload =
      'event: text_delta\ndata: {"delta":"你好，星火工厂"}\n\n' +
      'event: done\ndata: {"assistantMessageId":"a1","seq":2,"status":"completed"}\n\n'
    const fullBytes = encoder.encode(payload)
    // Cut right inside a UTF-8 character and mid-JSON
    const splitA = fullBytes.slice(0, 29)
    const splitB = fullBytes.slice(29, 55)
    const splitC = fullBytes.slice(55)

    const events = await collectEvents(streamFromChunks([splitA, splitB, splitC]))
    expect(events).toEqual([
      { type: "text_delta", delta: "你好，星火工厂" },
      { type: "done", assistantMessageId: "a1", seq: 2, status: "completed" },
    ])
  })

  it("parses multiple events in one chunk, CRLF delimiters, and ignores : ping comments", async () => {
    const singleChunk =
      ": ping\r\n\r\n" +
      'event: turn_start\r\ndata: {"jobId":"j1","userMessageId":"u1","seq":1,"nodeId":"n1","runtime":"api:qwen"}\r\n\r\n' +
      'event: reasoning_delta\r\ndata: {"delta":"思考"}\r\n\r\n' +
      ": keepalive comment\n\n" +
      'event: text_delta\r\ndata: {"delta":"回答"}\r\n\r\n'

    const events = await collectEvents(streamFromChunks([singleChunk]))
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ type: "turn_start", jobId: "j1" })
    expect(events[1]).toEqual({ type: "reasoning_delta", delta: "思考" })
    expect(events[2]).toEqual({ type: "text_delta", delta: "回答" })
  })

  it("flushes trailing complete frame without final blank line and ignores truncated JSON tail", async () => {
    const stream = streamFromChunks([
      'event: text_delta\ndata: {"delta":"ok"}\n\n',
      'event: text_delta\ndata: {"delta":"truncated',
    ])
    const events = await collectEvents(stream)
    expect(events).toEqual([{ type: "text_delta", delta: "ok" }])

    const tailValidStream = streamFromChunks(['event: text_delta\ndata: {"delta":"last"}'])
    expect(await collectEvents(tailValidStream)).toEqual([
      { type: "text_delta", delta: "last" },
    ])
  })

  it("stops reading when AbortSignal aborts", async () => {
    const ac = new AbortController()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"first"}\n\n'))
        setTimeout(() => ac.abort(), 5)
      },
    })

    const received: ChatStreamEvent[] = []
    await expect(
      (async () => {
        for await (const ev of parseSseStream(stream, ac.signal)) {
          received.push(ev)
        }
      })()
    ).rejects.toThrow()
    expect(received).toEqual([{ type: "text_delta", delta: "first" }])
  })

  it("ignores unknown event types and empty blocks in parseSseBlock", () => {
    expect(parseSseBlock(": ping")).toBeNull()
    expect(parseSseBlock('event: unknown_event\ndata: {"x":1}')).toBeNull()
    expect(parseSseBlock('event: text_delta\ndata: ["not-object"]')).toBeNull()
  })
})
