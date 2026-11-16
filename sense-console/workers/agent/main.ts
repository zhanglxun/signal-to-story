/**
 * Agent Harness worker entry: `npm --prefix sense-console run worker:agent`.
 * Independent process; reads its own environment only (see .env.example). Outbound HTTPS only.
 */
import { createClient } from "@supabase/supabase-js"

import { SupabaseBackend } from "./backends/supabase-backend"
import { buildLlmClientFromEnv, readWorkerConfig } from "./config"
import { consoleLogger, runWorkerLoop } from "./runner"
import { createVideoStoryboardHandler, SupabaseVideoStoryboardStore } from "./video-storyboard"

async function main() {
  const config = readWorkerConfig()
  const generator = buildLlmClientFromEnv("SENSE_LLM")
  if (!generator) throw new Error("缺少 SENSE_LLM_* 生成模型配置")
  const evaluator = buildLlmClientFromEnv("SENSE_EVAL_LLM") ?? generator
  if (evaluator === generator) consoleLogger.warn("evaluator uses the generator model; configure SENSE_EVAL_LLM_* for an independent evaluator")

  const client = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const controller = new AbortController()
  const stop = (signal: string) => {
    consoleLogger.info("shutdown requested", { signal })
    controller.abort()
  }
  process.once("SIGINT", () => stop("SIGINT"))
  process.once("SIGTERM", () => stop("SIGTERM"))

  await runWorkerLoop({
    backend: new SupabaseBackend(client),
    workerId: config.workerId,
    jobTypes: config.jobTypes,
    leaseSeconds: config.leaseSeconds,
    pollIntervalMs: config.pollIntervalMs,
    generator,
    evaluator,
    signal: controller.signal,
    jobHandlers: { video_storyboard: createVideoStoryboardHandler(new SupabaseVideoStoryboardStore(client)) },
  })
}

main().catch((error) => {
  consoleLogger.error("worker crashed", { error: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
