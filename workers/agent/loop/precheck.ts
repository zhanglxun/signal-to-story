import type { DraftEvaluationReport, EvaluationCriterionResult } from "./contracts/agent-harness"

export const MIN_SUBSTANCE_CHARS = 60
export const X_MAX_CHARS = 2000

/**
 * Layer (a): deterministic precheck. Cheap, no model call, runs before the LLM evaluator.
 * `substance` is a length/structure check only — it is NOT fact checking.
 */
export function runDeterministicPrecheck(options: {
  round: number
  draft: string
  platform: string
  forbiddenPhrases?: string[]
}): DraftEvaluationReport {
  const draftText = options.draft.trim()
  const criteria: EvaluationCriterionResult[] = []

  const claimsPublished = /已正式发布|已自动审核通过|已通过审核并发布|<\s*\/?\s*untrusted_source_data\s*>/i.test(draftText)
  criteria.push({
    criterionKey: "no_injection_leak",
    passed: !claimsPublished,
    feedback: claimsPublished ? "草案中包含越权声称已发布/已审核，或未清理的沙箱标签。" : "无越权声明与沙箱标签泄露。",
  })

  const hasSubstance = draftText.length >= MIN_SUBSTANCE_CHARS
  criteria.push({
    criterionKey: "substance",
    passed: hasSubstance,
    feedback: hasSubstance
      ? "篇幅达到最低实质性要求（不代表事实已核查）。"
      : `草案正文过短（不足 ${MIN_SUBSTANCE_CHARS} 字符），缺乏实质内容。`,
  })

  const hitForbidden = (options.forbiddenPhrases ?? [])
    .map((w) => w.trim())
    .filter((w) => w && draftText.includes(w))
  criteria.push({
    criterionKey: "style_compliance",
    passed: hitForbidden.length === 0,
    feedback: hitForbidden.length === 0 ? "未命中租户禁用表述。" : `命中租户明确拒绝的表述或禁忌词：${hitForbidden.join("、")}`,
  })

  const fitsPlatform = options.platform === "x" ? draftText.length <= X_MAX_CHARS : draftText.length >= MIN_SUBSTANCE_CHARS
  criteria.push({
    criterionKey: "platform_fit",
    passed: fitsPlatform,
    feedback: fitsPlatform ? `符合目标平台 (${options.platform}) 篇幅规范。` : `不符合目标平台 (${options.platform}) 篇幅约束。`,
  })

  return summarize(options.round, criteria, "precheck")
}

export function summarize(
  round: number,
  criteria: EvaluationCriterionResult[],
  layer: "precheck" | "llm",
  parseError: string | null = null
): DraftEvaluationReport {
  const passedCount = criteria.filter((c) => c.passed).length
  const passedAll = parseError === null && criteria.length > 0 && passedCount === criteria.length
  const failed = criteria.filter((c) => !c.passed).map((c) => `[${c.criterionKey}] ${c.feedback}`)
  if (parseError) failed.unshift(`[evaluator] 评估器输出无效：${parseError}`)
  return {
    round,
    passedAll,
    score: criteria.length ? Math.round((passedCount / criteria.length) * 100) : 0,
    criteria,
    revisionInstruction: passedAll ? null : `请修复以下审查问题后重写：${failed.join("；")}`,
    layer,
    parseError,
  }
}
