/**
 * Worker-side copy of the harness runtime contracts (R2, 2026-11-24). The console keeps its own
 * UI-facing copy in sense-console/src/contracts/agent-harness.ts; the two do not share code.
 */
export type CloudModelProviderKey =
  | "qwen"
  | "kimi"
  | "deepseek"
  | "zhipu"
  | "minimax"
  | "openai-compatible"

export type LocalAgentCliKey =
  | "pi-cli"
  | "opencode-cli"
  | "codex-cli"
  | "agy-cli"

export type ExecutionDriverMode = "cloud_api" | "local_cli"

export interface CloudModelProviderDefinition {
  key: CloudModelProviderKey
  name: string
  vendor: string
  defaultBaseUrl: string
  recommendedModels: string[]
  supportsJsonSchema: boolean
  notes: string
}

export interface LocalAgentCliDefinition {
  key: LocalAgentCliKey
  name: string
  binary: string
  headlessArgsTemplate: string[]
  outputFormat: "json" | "jsonl"
  supportsSkills: boolean
  notes: string
  /** How the prompt reaches the CLI. Never argv: prompts can be large and leak via `ps`. */
  promptTransport: "stdin" | "file"
  /** true only when the flags were checked against the installed CLI's `--help`. */
  verified: boolean
}

export type DecisionMemoryKind =
  | "approved_preference"
  | "rejected_pattern"
  | "style_rule"
  | "taboo_topic"

export interface DecisionMemoryItem {
  id: string
  organizationId: string
  kind: DecisionMemoryKind
  summary: string
  humanQuote: string
  recordedAt: string
  active: boolean
  /** null/undefined = applies to every platform. */
  platform?: string | null
  /** null/undefined = applies to every content kind. */
  contentKind?: string | null
  expiresAt?: string | null
}

export type KnowledgeTrustLevel = "trusted" | "unreviewed" | "archived"

export interface ContextKnowledgeSnippet {
  slug: string
  title: string
  content: string
  /** Only `trusted` enters the system zone. Missing = treated as unreviewed. */
  trustLevel?: KnowledgeTrustLevel
}

export type MandateActionType =
  | "publish_external"
  | "publish_site"
  | "paid_video_render"
  | "rotate_credentials"
  | "delete_project"
  | "change_org_permissions"

export interface MandateGateCheckInput {
  action: MandateActionType
  actorType: "agent" | "human"
  humanApprovalId?: string | null
  approvedRevision?: number | null
  targetRevision?: number | null
}

export interface MandateGateCheckResult {
  allowed: boolean
  requiresHumanApproval: boolean
  reason: string
}

export interface UntrustedSourceItem {
  sourceId: string
  channel: string
  url?: string | null
  rawText: string
  capturedAt: string
}

export interface SafeContextPackInput {
  organizationId: string
  taskGoal: string
  platform: string
  systemSop: string
  /** Used for memory scope filtering. */
  contentKind?: string | null
  decisionMemories?: DecisionMemoryItem[]
  /** Max memories injected (newest first). Default 20. */
  memoryLimit?: number
  knowledgeSnippets?: ContextKnowledgeSnippet[]
  untrustedSources: UntrustedSourceItem[]
  /** Clock for expiry filtering (tests). */
  now?: Date
}

export interface InjectionSignal {
  sourceId: string
  patternIds: string[]
}

export interface SafeContextPack {
  organizationId: string
  systemPrompt: string
  userPayloadPrompt: string
  injectedMemoryCount: number
  /** trusted + reference knowledge entries included anywhere in the pack. */
  injectedKnowledgeCount: number
  trustedKnowledgeCount: number
  referenceKnowledgeCount: number
  isolatedSourceCount: number
  /** Human-readable warnings. Injection detection is an alerting signal, not a defense. */
  sanitizedWarnings: string[]
  injectionSignals: InjectionSignal[]
  sourceIds: string[]
}

/**
 * `substance` = deterministic length/structure precheck (NOT fact checking).
 * `fact_grounding` is only ever produced by the LLM evaluator against the cited sources.
 */
export type EvaluationCriterionKey =
  | "substance"
  | "fact_grounding"
  | "style_compliance"
  | "no_injection_leak"
  | "platform_fit"

export interface EvaluationCriterionResult {
  criterionKey: EvaluationCriterionKey | (string & {})
  passed: boolean
  feedback: string
  /** Source ids the evaluator cited (LLM evaluator only). */
  sourceIds?: string[]
}

export interface DraftEvaluationReport {
  round: number
  passedAll: boolean
  score: number
  criteria: EvaluationCriterionResult[]
  revisionInstruction: string | null
  /** precheck = deterministic rules, llm = independent evaluator model. */
  layer?: "precheck" | "llm"
  /** Set when the LLM evaluator output failed JSON/zod validation (round counts as failed). */
  parseError?: string | null
}

export type HarnessLoopStatus =
  | "running"
  | "pending_review"
  | "blocked_needs_human"
  | "failed"

export interface HarnessLoopConfig {
  maxEvaluationRounds: number
  maxAgentHops: number
}

export interface HarnessLoopExecutionResult {
  status: HarnessLoopStatus
  finalDraft: string
  roundsExecuted: number
  hopsUsed: number
  evaluations: DraftEvaluationReport[]
  terminationReason: string
}
