/**
 * Agent Harness worker entry: `npm run worker:agent` (repo root).
 * Independent process; reads its own environment only (see .env.example). Outbound HTTPS only.
 */
import { createClient } from "@supabase/supabase-js"

import { NodeBackend, NodeVideoStoryboardStore, supabaseRpc } from "./backends/node-backend"
import { buildLlmClientFromEnv, readWorkerConfig } from "./config"
import { consoleLogger, runWorkerLoop } from "./runner"
import { createVideoStoryboardHandler } from "./video-storyboard"

async function main() {
  const config = readWorkerConfig()
  const generator = buildLlmClientFromEnv("SENSE_LLM")
  if (!generator) throw new Error("缺少 SENSE_LLM_* 生成模型配置")
  const evaluator = buildLlmClientFromEnv("SENSE_EVAL_LLM") ?? generator
  if (evaluator === generator) consoleLogger.warn("evaluator uses the generator model; configure SENSE_EVAL_LLM_* for an independent evaluator")

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

  await runWorkerLoop({
    backend: new NodeBackend(rpc, config.nodeToken),
    workerId: config.workerId,
    jobTypes: config.jobTypes,
    leaseSeconds: config.leaseSeconds,
    pollIntervalMs: config.pollIntervalMs,
    generator,
    evaluator,
    signal: controller.signal,
    jobHandlers: { video_storyboard: createVideoStoryboardHandler(new NodeVideoStoryboardStore(rpc, config.nodeToken)) },
  })
}

main().catch((error) => {
  consoleLogger.error("worker crashed", { error: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
