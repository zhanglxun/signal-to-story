#!/usr/bin/env node
/**
 * Scriptable fake ACP agent for AcpSessionDriver tests. Speaks newline-delimited JSON-RPC 2.0 on
 * stdio by hand (no SDK), so the tests exercise the real wire format.
 *
 * Usage: node fake-acp-agent.js <scenario.json>
 *
 * Scenario (all fields optional):
 *   {
 *     "loadSession": true,            // advertise agentCapabilities.loadSession
 *     "protocolVersion": 1,
 *     "sessionPrefix": "fake-sess",   // session ids are <prefix>-<n>
 *     "loadFails": false,             // session/load answers with an error
 *     "crashOn": "initialize",        // exit(3) when this method arrives
 *     "recordFile": "/abs/path",      // every received message is appended here as one JSON line
 *     "turns": [[step, ...], ...],    // steps for the n-th session/prompt (the last list repeats)
 *     "replayOnLoad": [update, ...]   // session/update notifications sent while loading
 *   }
 * Steps:
 *   { "update": <SessionUpdate> }                    send a session/update notification
 *   { "permission": { "toolCall": {...}, "options": [...] } }
 *                                                    ask session/request_permission; the outcome is
 *                                                    echoed back as an agent_message_chunk "perm:<optionId|cancelled>"
 *   { "sleep": 50 }
 *   { "waitCancel": true }                           block until session/cancel, then stop "cancelled"
 *   { "crash": 7 }                                   exit with this code mid-turn
 *   { "dumpEnv": true }                              send the env var names and cwd as a text chunk
 *   { "stop": "end_turn", "usage": {...} }           finish the prompt (default end_turn)
 */
import { appendFileSync, readFileSync } from "node:fs"

const scenario = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : {}
const record = (msg) => {
  if (scenario.recordFile) appendFileSync(scenario.recordFile, JSON.stringify(msg) + "\n")
}

let nextOutId = 1
const pendingOut = new Map()
let sessionCounter = 0
let promptCount = 0
let cancelWaiter = null
let cancelled = false

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n")
const notify = (sessionId, update) => send({ method: "session/update", params: { sessionId, update } })
const requestClient = (method, params) =>
  new Promise((resolve) => {
    const id = nextOutId++
    pendingOut.set(id, resolve)
    send({ id, method, params })
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runPrompt(id, params) {
  const turns = scenario.turns ?? [[{ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } } }]]
  const steps = turns[Math.min(promptCount, turns.length - 1)] ?? []
  promptCount += 1
  cancelled = false
  const sid = params.sessionId
  for (const step of steps) {
    if (cancelled) break
    if (step.update) notify(sid, step.update)
    else if (step.permission) {
      const res = await requestClient("session/request_permission", { sessionId: sid, ...step.permission })
      const outcome = res?.result?.outcome
      const label = outcome?.outcome === "selected" ? outcome.optionId : outcome?.outcome ?? "error"
      notify(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `perm:${label}` } })
    } else if (step.sleep) await sleep(step.sleep)
    else if (step.waitCancel) {
      if (!cancelled) await new Promise((r) => { cancelWaiter = r })
      send({ id, result: { stopReason: "cancelled" } })
      return
    } else if (step.crash !== undefined) {
      process.exit(step.crash)
    } else if (step.dumpEnv) {
      notify(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify({ env: Object.keys(process.env).sort(), cwd: process.cwd() }) } })
    } else if (step.stop) {
      send({ id, result: { stopReason: step.stop, ...(step.usage ? { usage: step.usage } : {}) } })
      return
    }
  }
  send({ id, result: { stopReason: cancelled ? "cancelled" : "end_turn" } })
}

async function handle(msg) {
  record(msg)
  if (msg.method && msg.method === scenario.crashOn) process.exit(3)
  if (msg.id !== undefined && !msg.method) {
    const resolve = pendingOut.get(msg.id)
    pendingOut.delete(msg.id)
    resolve?.(msg)
    return
  }
  switch (msg.method) {
    case "initialize":
      send({
        id: msg.id,
        result: {
          protocolVersion: scenario.protocolVersion ?? 1,
          agentCapabilities: { loadSession: Boolean(scenario.loadSession) },
          authMethods: [],
        },
      })
      return
    case "session/new":
      sessionCounter += 1
      send({ id: msg.id, result: { sessionId: `${scenario.sessionPrefix ?? "fake-sess"}-${sessionCounter}` } })
      return
    case "session/load":
      if (scenario.loadFails) {
        send({ id: msg.id, error: { code: -32002, message: "Resource not found" } })
        return
      }
      for (const update of scenario.replayOnLoad ?? []) notify(msg.params.sessionId, update)
      send({ id: msg.id, result: {} })
      return
    case "session/prompt":
      void runPrompt(msg.id, msg.params)
      return
    case "session/cancel":
      cancelled = true
      cancelWaiter?.()
      cancelWaiter = null
      return
    default:
      if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } })
  }
}

let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (line) void handle(JSON.parse(line))
  }
})
process.stdin.on("end", () => process.exit(0))
