/**
 * Compatibility facade. The harness core lives in `src/harness/` so the Node worker
 * (workers/agent) can share it. Keep importing from here in existing UI code.
 */
import type { DraftEvaluationReport, HarnessLoopConfig, HarnessLoopExecutionResult } from "@/contracts/agent-harness"
import { runDeterministicPrecheck } from "@/harness/precheck"

export {
  buildCloudModelRequest,
  buildLocalCliInvocation,
  CLOUD_MODEL_PROVIDERS,
  getCloudModelProvider,
  getLocalAgentCliDriver,
  LOCAL_AGENT_CLI_DRIVERS,
} from "@/harness/providers"
export { buildSafeContextPack, selectScopedMemories, DEFAULT_MEMORY_LIMIT } from "@/harness/context-pack"
export { detectInjectionSignals, INJECTION_SIGNAL_PATTERNS } from "@/harness/injection"
export { checkMandateGate, MANDATE_GATED_JOB_TYPES, MANDATE_REQUIRED_ACTIONS } from "@/harness/mandate"
export { runDeterministicPrecheck } from "@/harness/precheck"

export const DEFAULT_HARNESS_LOOP_CONFIG: HarnessLoopConfig = {
  maxEvaluationRounds: 3,
  maxAgentHops: 8,
}

/**
 * Deterministic precheck only (layer a). Kept for existing callers.
 * Production evaluation also runs the independent LLM evaluator — see `runHarnessJob`.
 */
export function evaluateDraftReadOnly(options: {
  round: number
  draft: string
  platform: string
  forbiddenPhrases?: string[]
}): DraftEvaluationReport {
  return runDeterministicPrecheck(options)
}

/**
 * In-memory Generator <-> precheck loop (no persistence, no LLM evaluator).
 * For UI demos and tests. The real worker uses `runHarnessJob` with a JobStore.
 */
export async function runGeneratorEvaluatorLoop(options: {
  platform: string
  forbiddenPhrases?: string[]
  config?: Partial<HarnessLoopConfig>
  initialHops?: number
  generateDraft: (round: number, revisionFeedback: string | null) => Promise<string>
}): Promise<HarnessLoopExecutionResult> {
  const maxRounds = Math.min(Math.max(options.config?.maxEvaluationRounds ?? DEFAULT_HARNESS_LOOP_CONFIG.maxEvaluationRounds, 1), 5)
  const maxHops = Math.min(Math.max(options.config?.maxAgentHops ?? DEFAULT_HARNESS_LOOP_CONFIG.maxAgentHops, 2), 12)
  let hopsUsed = options.initialHops ?? 0
  let latestDraft = ""
  let revisionFeedback: string | null = null
  const evaluations: DraftEvaluationReport[] = []

  for (let round = 1; round <= maxRounds; round++) {
    if (hopsUsed + 2 > maxHops) {
      return {
        status: "blocked_needs_human",
        finalDraft: latestDraft,
        roundsExecuted: round - 1,
        hopsUsed,
        evaluations,
        terminationReason: `触发跳数熔断上限 (maxAgentHops=${maxHops})，已停止循环并转交人工处理。`,
      }
    }
    hopsUsed += 1
    latestDraft = await options.generateDraft(round, revisionFeedback)
    hopsUsed += 1
    const report = runDeterministicPrecheck({ round, draft: latestDraft, platform: options.platform, forbiddenPhrases: options.forbiddenPhrases })
    evaluations.push(report)
    if (report.passedAll) {
      return {
        status: "pending_review",
        finalDraft: latestDraft,
        roundsExecuted: round,
        hopsUsed,
        evaluations,
        terminationReason: `第 ${round} 轮通过确定性预检，已挂起为待人工审核。`,
      }
    }
    revisionFeedback = report.revisionInstruction
  }
  return {
    status: "blocked_needs_human",
    finalDraft: latestDraft,
    roundsExecuted: maxRounds,
    hopsUsed,
    evaluations,
    terminationReason: `已达到最大生成-评估循环轮数上限 (${maxRounds} 轮) 仍未完全通过，已停止自动重试并挂起等待人工介入。`,
  }
}
