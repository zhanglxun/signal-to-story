/**
 * Prompt-injection *signals*. These are heuristics for alerting/audit only.
 * The real defenses are structural:
 *   1. The agent/worker has no write access to formal content (DB grants + triggers).
 *   2. Every model output is schema-validated before it is stored (zod).
 *   3. Publishing / paid actions are gated in the database (approval_requests + triggers).
 * A clean scan never means "safe"; a hit never blocks by itself.
 */

interface InjectionPattern {
  id: string
  // Never use the `g` flag here: RegExp.test() with `g` is stateful (lastIndex) and
  // silently skips matches on subsequent calls.
  pattern: RegExp
}

export const INJECTION_SIGNAL_PATTERNS: readonly InjectionPattern[] = [
  { id: "ignore_previous_en", pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i },
  { id: "system_override_en", pattern: /system\s*override/i },
  { id: "role_reassign_en", pattern: /you\s+are\s+now\s+(a|an|the)\b/i },
  { id: "ignore_previous_zh", pattern: /忽略(之前|以上|所有|上述)(的)?(指令|要求|规则)/ },
  { id: "direct_action_zh", pattern: /直接(批准|发布|删除)/ },
  { id: "sandbox_tag_escape", pattern: /<\s*\/?\s*(untrusted_source_data|untrusted_reference_knowledge|system_instruction|system_sop|tenant_decision_memory|project_knowledge_base|current_document|evaluator_feedback|previous_draft)\b[^>]*>/i },
]

const ZONE_TAG = /<\s*\/?\s*(untrusted_source_data|untrusted_reference_knowledge|system_instruction|system_sop|tenant_decision_memory|project_knowledge_base|current_document|evaluator_feedback|previous_draft|task_goal)\b[^>]*>/gi

/** Returns the ids of every signal pattern found in `text`. Stateless and repeatable. */
export function detectInjectionSignals(text: string): string[] {
  const hits: string[] = []
  for (const { id, pattern } of INJECTION_SIGNAL_PATTERNS) {
    const safe = pattern.flags.includes("g") ? new RegExp(pattern.source, pattern.flags.replace("g", "")) : pattern
    if (safe.test(text)) hits.push(id)
  }
  return hits
}

/** Neutralize any text that looks like one of our context-zone tags so data cannot close a zone. */
export function escapeZoneTags(text: string): string {
  return text.replace(ZONE_TAG, "[ESCAPED_TAG]")
}
