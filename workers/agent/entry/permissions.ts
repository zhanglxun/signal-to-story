/**
 * Pending permission requests of the turns running on this node (docs/modules/chat.md 2.5).
 * A request is answered by POST /v1/chat/turns/{job_id}/permissions/{request_id} from the same user;
 * no answer within 5 minutes counts as "timeout" (treated as deny), a lost stream as "deny".
 */
import type { PermissionDecision } from "../loop/chat/driver"

export const PERMISSION_TIMEOUT_MS = 5 * 60_000

type Answer = PermissionDecision | "timeout"

interface Pending {
  userId: string
  settle: (answer: Answer) => void
}

export type PermissionAnswerResult = "answered" | "not_found" | "forbidden"

export class PermissionBroker {
  private readonly pending = new Map<string, Pending>()
  private readonly timeoutMs: number

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? PERMISSION_TIMEOUT_MS
  }

  private static key(jobId: string, requestId: string) {
    return `${jobId}/${requestId}`
  }

  get size(): number {
    return this.pending.size
  }

  /** Resolves with the user's answer, "timeout", or "deny" when denyJob() is called; rejects when `signal` aborts. */
  wait(jobId: string, requestId: string, userId: string, signal: AbortSignal): Promise<Answer> {
    const key = PermissionBroker.key(jobId, requestId)
    return new Promise<Answer>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("aborted"))
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
        this.pending.delete(key)
      }
      const onAbort = () => {
        done()
        reject(new Error("aborted"))
      }
      const timer = setTimeout(() => {
        done()
        resolve("timeout")
      }, this.timeoutMs)
      timer.unref?.()
      signal.addEventListener("abort", onAbort, { once: true })
      this.pending.set(key, {
        userId,
        settle: (answer) => {
          done()
          resolve(answer)
        },
      })
    })
  }

  answer(jobId: string, requestId: string, userId: string, decision: PermissionDecision): PermissionAnswerResult {
    const entry = this.pending.get(PermissionBroker.key(jobId, requestId))
    if (!entry) return "not_found"
    if (entry.userId !== userId) return "forbidden"
    entry.settle(decision)
    return "answered"
  }

  /** The stream of `jobId` is gone: nobody can answer its pending requests any more. */
  denyJob(jobId: string): void {
    for (const [key, entry] of [...this.pending]) {
      if (key.startsWith(`${jobId}/`)) entry.settle("deny")
    }
  }
}
