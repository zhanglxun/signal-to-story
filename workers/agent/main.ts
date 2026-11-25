/**
 * Agent worker entry: `npm run worker:agent` (repo root).
 * Independent process; reads its own environment only (see README). Two entries share one process:
 *  - queue (entry/queue.ts): outbound only, claims agent_jobs (never chat_turn); needs SENSE_LLM_*
 *  - HTTP/SSE (entry/http.ts): chat turns; enabled only when SENSE_HTTP_PORT is set
 * The node reports its runtime catalog on startup and every 5 minutes.
 */
import { createClient } from "@supabase/supabase-js"

import { createSupabaseUserDataFactory, createSupabaseUserVerifier, NodeChatBackend } from "./backends/chat-db"
import { NodeBackend, NodeVideoStoryboardStore, supabaseRpc } from "./backends/node-backend"
import { buildLlmClientFromEnv, readHttpConfig, readWorkerConfig } from "./config"
import { createAcpRuntimeFromEnv, readAcpCliSpecs } from "./drivers/acp-config"
import { startCapabilityReporting } from "./entry/capabilities"
import { createChatHttpServer, listen } from "./entry/http"
import { consoleLogger, runWorkerLoop } from "./entry/queue"
import { acpCatalogEntries, NodeRuntimeResolver } from "./entry/runtimes"
import { NodeCapabilityReporter, RuntimeRegistry } from "./runtime-registry"
import { createVideoStoryboardHandler } from "./video-storyboard"

async function main() {
  const config = readWorkerConfig()
  const http = readHttpConfig()
  const generator = buildLlmClientFromEnv("SENSE_LLM")
  if (!generator && !http) throw new Error("缺少 SENSE_LLM_* 生成模型配置（或设置 SENSE_HTTP_PORT 只运行 Chat 入口）")

  // Publishable key + node token only: the database resolves the node and scopes it to its organization.
  const client = createClient(config.supabaseUrl, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const rpc = supabaseRpc(client)
  const controller = new AbortController()
  const stop = (signal: string) => {
    consoleLogger.info("shutdown requested", { signal })
    controller.abort()
  }
  process.once("SIGINT", () => stop("SIGINT"))
  process.once("SIGTERM", () => stop("SIGTERM"))

  const nodeChat = new NodeChatBackend(rpc, config.nodeToken)
  const registry = RuntimeRegistry.fromEnv()
  const acp = http ? createAcpRuntimeFromEnv({ nodeId: http.nodeId }) : null
  const acpSpecs = acp ? readAcpCliSpecs(process.env) : []

  await startCapabilityReporting({
    registry,
    reporter: new NodeCapabilityReporter((caps) => nodeChat.reportCapabilities(caps)),
    catalog: { supportsHttpSse: Boolean(http), httpEndpointHint: http?.publicUrl ?? "", extraRuntimes: acpCatalogEntries(acpSpecs) },
    signal: controller.signal,
    logger: consoleLogger,
  })

  const tasks: Promise<unknown>[] = []
  if (http) {
    const entry = createChatHttpServer({
      nodeId: http.nodeId,
      node: nodeChat,
      verifyUser: createSupabaseUserVerifier(config.supabaseUrl, config.publishableKey),
      userData: createSupabaseUserDataFactory(config.supabaseUrl, config.publishableKey),
      runtimes: new NodeRuntimeResolver({ registry, acp }),
      allowedOrigins: http.allowedOrigins,
      leaseSeconds: config.leaseSeconds,
      maxConcurrentTurnsPerUser: http.maxConcurrentTurnsPerUser,
      turnsPerMinute: http.turnsPerMinute,
      turnLimits: { budgetCents: http.budgetCents, maxRounds: http.maxRounds },
      shutdownSignal: controller.signal,
      logger: consoleLogger,
    })
    const port = await listen(entry.server, http.port, http.host)
    consoleLogger.info("http entry listening", { host: http.host, port, node_id: http.nodeId, public_url: http.publicUrl })
    tasks.push(
      new Promise<void>((resolve) => {
        controller.signal.addEventListener("abort", () => {
          entry.server.close()
          // Running turns see the abort, persist as cancelled, then the server finishes closing.
          void entry.idle().then(async () => {
            await acp?.registry.shutdownAll()
            resolve()
          })
        }, { once: true })
      }),
    )
  }
  if (generator) {
    const evaluator = buildLlmClientFromEnv("SENSE_EVAL_LLM") ?? generator
    if (evaluator === generator) consoleLogger.warn("evaluator uses the generator model; configure SENSE_EVAL_LLM_* for an independent evaluator")
    tasks.push(
      runWorkerLoop({
        backend: new NodeBackend(rpc, config.nodeToken),
        workerId: config.workerId,
        jobTypes: config.jobTypes,
        leaseSeconds: config.leaseSeconds,
        pollIntervalMs: config.pollIntervalMs,
        generator,
        evaluator,
        signal: controller.signal,
        jobHandlers: { video_storyboard: createVideoStoryboardHandler(new NodeVideoStoryboardStore(rpc, config.nodeToken)) },
      }),
    )
  } else {
    consoleLogger.warn("SENSE_LLM_* not set: queue entry disabled, serving chat over HTTP only")
  }
  await Promise.all(tasks)
}

main().catch((error) => {
  consoleLogger.error("worker crashed", { error: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
