import type { DecisionMemoryKind } from "../contracts/agent-harness"
import { MEMORY_QUOTE_MAX, MEMORY_SUMMARY_MAX, type DecisionMemoryInput, type DecisionMemorySource } from "../contracts/decision-memory"

/** State of the RememberDecisionField checkbox block. */
export interface RememberDecisionValue {
  enabled: boolean
  summary: string
  /** "platform" keeps the document's platform as scope; "global" applies everywhere. */
  scope: "platform" | "global"
}

export const emptyRememberValue: RememberDecisionValue = { enabled: false, summary: "", scope: "platform" }

/**
 * Turn the field state plus the human's original words into a decision_memories insert.
 * Returns null when not enabled. Throws a user-readable Error when enabled but unusable, so callers
 * can validate *before* performing the main action (reject / approve / save).
 */
export function buildDecisionMemoryInput(
  value: RememberDecisionValue,
  context: {
    organizationId: string
    kind: DecisionMemoryKind
    /** The human's own words (review note / retrospective). Stored verbatim as human_quote. */
    quote: string
    platform: string | null
    source: DecisionMemorySource
    sourceRef: string | null
  }
): DecisionMemoryInput | null {
  if (!value.enabled) return null
  const quote = context.quote.trim()
  const summary = (value.summary.trim() || quote).slice(0, MEMORY_SUMMARY_MAX)
  if (!summary) throw new Error("请填写要记入长期偏好的摘要")
  return {
    organizationId: context.organizationId,
    kind: context.kind,
    summary,
    humanQuote: quote.slice(0, MEMORY_QUOTE_MAX),
    platform: value.scope === "global" ? null : context.platform,
    source: context.source,
    sourceRef: context.sourceRef,
  }
}
