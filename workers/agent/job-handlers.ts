import type { HarnessJob } from "../../sense-console/src/harness/job-store"
import type { LlmClient } from "../../sense-console/src/harness/llm"
import type { AgentQueueBackend, ClaimedJobRow } from "./backend"

/** Context handed to a non-content_draft job handler registered in WorkerOptions.jobHandlers. */
export interface JobHandlerContext {
  job: HarnessJob
  claimed: ClaimedJobRow
  backend: AgentQueueBackend
  leaseSeconds: number
  generator: LlmClient
  signal?: AbortSignal
}

export interface JobHandlerOutcome {
  status: "pending_review" | "blocked_needs_human" | "failed" | "cancelled" | "succeeded"
  reason: string
  roundsExecuted: number
  costCents: number
  proposalId: string | null
}

/**
 * A handler owns the job until it calls backend.complete / backend.fail with job.leaseEpoch. Thrown errors are handled by the
 * runner exactly like content_draft errors (LlmCallError → no auto-retry when billable, LeaseLostError → no writes).
 */
export type JobHandler = (context: JobHandlerContext) => Promise<JobHandlerOutcome>
