import { z } from "zod"

import type { DraftEvaluationReport, SafeContextPack } from "../contracts/agent-harness"
import { escapeZoneTags } from "./injection"
import type { HarnessJob, HarnessProgress, HarnessStepKind, HarnessStepRecord, HarnessTerminalStatus, JobStore } from "./job-store"
import { type ChatMessage, type LlmClient, type LlmUsage, stripCodeFence, ZERO_USAGE } from "./llm"
import { DEFAULT_EVALUATION_CHECKLIST, type EvaluationChecklistItem, runLlmEvaluation } from "./llm-evaluator"
import { runDeterministicPrecheck } from "./precheck"

export const HARNESS_PROMPT_VERSION = "harness-v1"

/** Everything the controller needs about the draft task, assembled by a context loader. */
export interface HarnessDraftContext {
  documentId: string
  documentRevision: number
  platform: string
  title: string
  body: string
  instruction: string
  /** JSON of the project brief, stored on the proposal for audit. */
  brief: string
  contextPack: SafeContextPack
  /** Raw source texts for the evaluator (ids must match contextPack.sourceIds). */
  sources: Array<{ sourceId: string; content: string }>
  forbiddenPhrases: string[]
  evaluatorRules?: string[]
}

export type HarnessEvent =
  | { type: "step"; step: HarnessStepRecord; resumed: boolean }
  | { type: "finish"; status: HarnessTerminalStatus; reason: string }

export interface RunHarnessJobOptions {
  job: HarnessJob
  store: JobStore
  context: HarnessDraftContext
  generator: LlmClient
  /** Independent evaluator model. null = deterministic precheck only (not recommended in production). */
  evaluator: LlmClient | null
  checklist?: readonly EvaluationChecklistItem[]
  signal?: AbortSignal
  onEvent?: (event: HarnessEvent) => void
}

export interface HarnessRunOutcome {
  status: HarnessTerminalStatus
  roundsExecuted: number
  hopsUsed: number
  costCents: number
  tokensUsed: number
  proposalId: string | null
  finalDraft: string
  evaluations: DraftEvaluationReport[]
  terminationReason: string
}

export class LeaseLostError extends Error {
  constructor() {
    super("任务租约已丢失，停止执行且不再写入")
    this.name = "LeaseLostError"
  }
}

const draftSchema = z.string().trim().min(1).max(100_000)

async function sha256Hex(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")
}

function progressFromSteps(steps: readonly HarnessStepRecord[]): HarnessProgress {
  let hops = 0
  let cost = 0
  let tokens = 0
  let rounds = 0
  for (const s of steps) {
    if ((s.stepKind === "generate" || s.stepKind === "evaluate") && s.driver) hops += 1
    cost += s.costCents
    tokens += (s.usage?.inputTokens ?? 0) + (s.usage?.outputTokens ?? 0)
    if (s.stepKind === "generate") rounds = Math.max(rounds, s.round)
  }
  return { rounds, hopsUsed: hops, costCents: Math.round(cost * 10_000) / 10_000, tokensUsed: tokens }
}

export function buildGeneratorMessages(context: HarnessDraftContext, feedback: string | null, previousDraft: string | null): ChatMessage[] {
  const system = [
    context.contextPack.systemPrompt,
    "",
    "输出要求：只输出可直接作为稿件正文的 Markdown 草案，不要输出解释、JSON 或代码块包裹。",
  ].join("\n")
  const parts = [
    context.contextPack.userPayloadPrompt,
    "",
    "<current_document>",
    JSON.stringify({ platform: context.platform, title: escapeZoneTags(context.title), body: escapeZoneTags(context.body), brief: escapeZoneTags(context.brief) }, null, 2),
    "</current_document>",
  ]
  if (feedback) parts.push("", "<evaluator_feedback>", escapeZoneTags(feedback), "</evaluator_feedback>")
  if (previousDraft) parts.push("", "<previous_draft>", escapeZoneTags(previousDraft), "</previous_draft>")
  return [
    { role: "system", content: system },
    { role: "user", content: parts.join("\n") },
  ]
}

/**
 * Generator <-> Evaluator loop with durable steps.
 * Per round: generate -> deterministic precheck -> (if precheck passed) LLM evaluation.
 * Passing round => content_ai_proposals row (status succeeded) + job pending_review.
 * Limits (max rounds / hops / budget / tokens) => blocked_needs_human. Never edits the formal document.
 * Resumable: completed steps are read back from the store and not re-executed.
 */
export async function runHarnessJob(options: RunHarnessJobOptions): Promise<HarnessRunOutcome> {
  const { job, store, context, generator, evaluator } = options
  const checklist = options.checklist ?? DEFAULT_EVALUATION_CHECKLIST
  const steps = await store.listSteps(job.id)
  const find = (round: number, kind: HarnessStepKind) => steps.find((s) => s.round === round && s.stepKind === kind)
  const evaluations: DraftEvaluationReport[] = []
  let latestDraft = ""
  let feedback: string | null = null
  let lastUsage: LlmUsage = ZERO_USAGE
  let lastModel = generator.model

  const record = async (step: HarnessStepRecord) => {
    await store.recordStep(step)
    steps.push(step)
    options.onEvent?.({ type: "step", step, resumed: false })
    await store.updateProgress(job.id, { ...progressFromSteps(steps), driver: generator.driver, model: generator.model })
  }
  const checkLease = async () => {
    const beat = await store.heartbeat(job.id)
    if (!beat.ok) throw new LeaseLostError()
    return beat.cancelRequested
  }
  const finish = async (status: HarnessTerminalStatus, reason: string, extra: { proposalId?: string | null; errorCode?: string } = {}): Promise<HarnessRunOutcome> => {
    const p = progressFromSteps(steps)
    const result = {
      termination_reason: reason,
      rounds_executed: p.rounds,
      hops_used: p.hopsUsed,
      cost_cents: p.costCents,
      tokens_used: p.tokensUsed,
      proposal_id: extra.proposalId ?? null,
      last_score: evaluations.at(-1)?.score ?? null,
    }
    await store.updateProgress(job.id, { ...p, driver: generator.driver, model: generator.model })
    await store.finish(job.id, {
      status,
      result,
      error: status === "pending_review" ? null : reason,
      errorCode: extra.errorCode ?? null,
    })
    options.onEvent?.({ type: "finish", status, reason })
    return {
      status,
      roundsExecuted: p.rounds,
      hopsUsed: p.hopsUsed,
      costCents: p.costCents,
      tokensUsed: p.tokensUsed,
      proposalId: extra.proposalId ?? null,
      finalDraft: latestDraft,
      evaluations,
      terminationReason: reason,
    }
  }

  for (const s of steps) options.onEvent?.({ type: "step", step: s, resumed: true })

  const persisted = steps.find((s) => s.stepKind === "persist")
  if (persisted) {
    const out = persisted.output as { proposalId?: string; draft?: string } | undefined
    latestDraft = out?.draft ?? ""
    return finish("pending_review", "已从中断处恢复：提案此前已保存，挂起待人工审核。", { proposalId: out?.proposalId ?? null })
  }

  if (!find(0, "context")) {
    await record({
      jobId: job.id,
      organizationId: job.organizationId,
      round: 0,
      stepKind: "context",
      status: "succeeded",
      inputDigest: await sha256Hex(context.contextPack.systemPrompt + "\n" + context.contextPack.userPayloadPrompt),
      inputSummary: {
        document_id: context.documentId,
        document_revision: context.documentRevision,
        platform: context.platform,
        memories: context.contextPack.injectedMemoryCount,
        trusted_knowledge: context.contextPack.trustedKnowledgeCount,
        reference_knowledge: context.contextPack.referenceKnowledgeCount,
        sources: context.contextPack.isolatedSourceCount,
      },
      output: { injection_signals: context.contextPack.injectionSignals, warnings: context.contextPack.sanitizedWarnings },
      costCents: 0,
      durationMs: 0,
    })
  }

  const hopsPerRound = evaluator ? 2 : 1
  for (let round = 1; round <= job.maxRounds; round++) {
    if (await checkLease()) return finish("cancelled", "人工取消，已在步骤边界停止。", { errorCode: "cancelled" })

    // ---- generate
    let gen = find(round, "generate")
    if (!gen) {
      const p = progressFromSteps(steps)
      if (p.hopsUsed + hopsPerRound > job.maxHops) {
        return finish("blocked_needs_human", `触发跳数上限 (max_hops=${job.maxHops})，已停止并转交人工。`, { errorCode: "max_hops" })
      }
      if (p.costCents > 0 && p.costCents >= job.budgetCents) {
        return finish("blocked_needs_human", `已达到预算上限 (${p.costCents}/${job.budgetCents} 分)，已停止并转交人工。`, { errorCode: "budget" })
      }
      if (job.tokenBudget && p.tokensUsed >= job.tokenBudget) {
        return finish("blocked_needs_human", `已达到 Token 上限 (${p.tokensUsed}/${job.tokenBudget})，已停止并转交人工。`, { errorCode: "token_budget" })
      }
      const messages = buildGeneratorMessages(context, feedback, latestDraft || null)
      const started = Date.now()
      const response = await generator.complete({ messages, maxTokens: 5000, signal: options.signal })
      const parsed = draftSchema.safeParse(stripCodeFence(response.text))
      gen = {
        jobId: job.id,
        organizationId: job.organizationId,
        round,
        stepKind: "generate",
        status: parsed.success ? "succeeded" : "failed",
        driver: response.driver,
        model: response.model,
        inputDigest: await sha256Hex(messages.map((m) => m.content).join("\n")),
        inputSummary: { has_feedback: Boolean(feedback), previous_draft_chars: latestDraft.length },
        output: { draft: parsed.success ? parsed.data : response.text.slice(0, 2000) },
        usage: response.usage,
        costCents: response.usage.costCents,
        durationMs: Date.now() - started,
        error: parsed.success ? null : "模型没有返回有效草案（空或超过 100000 字符）",
      }
      await record(gen)
    }
    const genOut = gen.output as { draft?: string } | undefined
    if (gen.status === "failed") {
      feedback = gen.error ?? "上一轮没有产出有效草案，请重新生成完整正文。"
      continue
    }
    latestDraft = genOut?.draft ?? ""
    if (gen.usage) lastUsage = { inputTokens: gen.usage.inputTokens ?? 0, outputTokens: gen.usage.outputTokens ?? 0, costCents: gen.usage.costCents ?? 0 }
    lastModel = gen.model ?? generator.model

    // ---- deterministic precheck
    let pre = find(round, "precheck")
    if (!pre) {
      const report = runDeterministicPrecheck({ round, draft: latestDraft, platform: context.platform, forbiddenPhrases: context.forbiddenPhrases })
      pre = {
        jobId: job.id,
        organizationId: job.organizationId,
        round,
        stepKind: "precheck",
        status: report.passedAll ? "succeeded" : "failed",
        evaluation: report,
        costCents: 0,
        durationMs: 0,
      }
      await record(pre)
    }
    const preReport = pre.evaluation as DraftEvaluationReport
    if (!preReport.passedAll) {
      evaluations.push(preReport)
      feedback = preReport.revisionInstruction
      continue
    }

    // ---- LLM evaluation
    let finalReport = preReport
    if (evaluator) {
      if (await checkLease()) return finish("cancelled", "人工取消，已在步骤边界停止。", { errorCode: "cancelled" })
      let ev = find(round, "evaluate")
      if (!ev) {
        const started = Date.now()
        const result = await runLlmEvaluation(
          evaluator,
          { round, draft: latestDraft, platform: context.platform, sources: context.sources, checklist, rules: context.evaluatorRules },
          options.signal
        )
        ev = {
          jobId: job.id,
          organizationId: job.organizationId,
          round,
          stepKind: "evaluate",
          status: result.report.passedAll ? "succeeded" : "failed",
          driver: result.driver,
          model: result.model,
          output: { raw: result.rawText.slice(0, 8000) },
          evaluation: result.report,
          usage: result.usage,
          costCents: result.usage.costCents,
          durationMs: Date.now() - started,
          error: result.report.parseError ?? null,
        }
        await record(ev)
      }
      finalReport = ev.evaluation as DraftEvaluationReport
    }
    evaluations.push(finalReport)

    if (finalReport.passedAll) {
      if (await checkLease()) return finish("cancelled", "人工取消，已在步骤边界停止。", { errorCode: "cancelled" })
      const { proposalId } = await store.saveProposal({
        job,
        documentId: context.documentId,
        inputRevision: context.documentRevision,
        body: latestDraft,
        model: lastModel,
        instruction: context.instruction,
        inputBrief: context.brief,
        usage: lastUsage,
        promptVersion: HARNESS_PROMPT_VERSION,
      })
      await record({
        jobId: job.id,
        organizationId: job.organizationId,
        round,
        stepKind: "persist",
        status: "succeeded",
        output: { proposalId, draft: latestDraft },
        costCents: 0,
        durationMs: 0,
      })
      return finish("pending_review", `第 ${round} 轮通过预检与独立评估，已保存为待人工审核提案（挂起零消耗）。`, { proposalId })
    }
    feedback = finalReport.revisionInstruction
  }

  return finish("blocked_needs_human", `已达到最大生成-评估轮数 (${job.maxRounds}) 仍未通过，已停止自动重试并挂起等待人工介入。`, { errorCode: "max_rounds" })
}
