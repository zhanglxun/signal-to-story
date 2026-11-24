import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatSessionRepository } from "@/modules/chat/services/chat-session-service"
import type { ChatMessage } from "@/modules/chat/types"

export const DEFAULT_PENDING_POLL_INTERVAL_MS = 2000
export const DEFAULT_PENDING_MAX_WAIT_MS = 60_000

export interface PendingTurnPlaceholder {
  sessionId: string
  jobId: string | null
  reason: "stopping" | "running" | "queued"
  runtimeLabel?: string
}

export interface UsePendingTurnOptions {
  repository: ChatSessionRepository
  sessionId: string | null
  messages: readonly ChatMessage[]
  isStreamingLocally: boolean
  onSettled?: (sessionId: string) => void | Promise<void>
  pollIntervalMs?: number
  maxWaitMs?: number
}

export function usePendingTurn({
  repository,
  sessionId,
  messages,
  isStreamingLocally,
  onSettled,
  pollIntervalMs = DEFAULT_PENDING_POLL_INTERVAL_MS,
  maxWaitMs = DEFAULT_PENDING_MAX_WAIT_MS,
}: UsePendingTurnOptions) {
  const [manualPending, setManualPending] = useState<PendingTurnPlaceholder | null>(null)
  const [detectedPending, setDetectedPending] = useState<PendingTurnPlaceholder | null>(null)

  const onSettledRef = useRef(onSettled)
  useEffect(() => {
    onSettledRef.current = onSettled
  }, [onSettled])

  // Detect active queued/running chat_turn when entering or re-entering a session.
  useEffect(() => {
    if (!sessionId || isStreamingLocally || !repository.findActiveChatTurnJob) {
      return
    }
    let active = true
    void repository
      .findActiveChatTurnJob(sessionId)
      .then((job) => {
        if (!active) return
        if (job) {
          setDetectedPending({
            sessionId,
            jobId: job.jobId,
            reason: job.status,
          })
        } else {
          setDetectedPending((prev) => (prev?.sessionId === sessionId ? null : prev))
        }
      })
      .catch(() => {
        // Ignore transient lookup errors.
      })
    return () => {
      active = false
    }
  }, [isStreamingLocally, repository, sessionId])

  let rawPending: PendingTurnPlaceholder | null = null
  if (!isStreamingLocally && sessionId) {
    if (manualPending && manualPending.sessionId === sessionId) {
      rawPending = manualPending
    } else if (detectedPending && detectedPending.sessionId === sessionId) {
      rawPending = detectedPending
    }
  }

  const alreadyPersisted =
    rawPending !== null &&
    rawPending.jobId !== null &&
    messages.some((m) => m.role === "assistant" && m.agentJobId === rawPending.jobId)

  const pendingTurn = alreadyPersisted ? null : rawPending

  const hasPending = pendingTurn !== null
  const pendingSessionId = pendingTurn?.sessionId ?? null
  const pendingJobId = pendingTurn?.jobId ?? null

  useEffect(() => {
    if (!hasPending || !pendingSessionId) return
    let cancelled = false
    const deadline = Date.now() + maxWaitMs

    const clearForSession = () => {
      setManualPending((prev) => (prev?.sessionId === pendingSessionId ? null : prev))
      setDetectedPending((prev) => (prev?.sessionId === pendingSessionId ? null : prev))
    }

    const checkOnce = async () => {
      if (cancelled) return
      try {
        const rows = await repository.listMessages(pendingSessionId)
        if (cancelled) return

        const foundByJob =
          pendingJobId !== null &&
          rows.some((m) => m.role === "assistant" && m.agentJobId === pendingJobId)

        if (foundByJob) {
          clearForSession()
          await onSettledRef.current?.(pendingSessionId)
          return
        }

        if (repository.findActiveChatTurnJob) {
          const activeJob = await repository.findActiveChatTurnJob(pendingSessionId)
          if (cancelled) return
          if (!activeJob || (pendingJobId && activeJob.jobId !== pendingJobId)) {
            await repository.listMessages(pendingSessionId)
            if (cancelled) return
            clearForSession()
            await onSettledRef.current?.(pendingSessionId)
            return
          }
        }
      } catch {
        // Keep waiting until deadline on transient failures.
      }

      if (!cancelled && Date.now() >= deadline) {
        clearForSession()
        await onSettledRef.current?.(pendingSessionId)
      }
    }

    const unsubscribe = repository.subscribeChatMessages?.(pendingSessionId, () => {
      void checkOnce()
    })
    const intervalId = setInterval(() => {
      void checkOnce()
    }, pollIntervalMs)
    const timeoutId = setTimeout(() => {
      if (cancelled) return
      clearForSession()
      void onSettledRef.current?.(pendingSessionId)
    }, maxWaitMs)

    return () => {
      cancelled = true
      clearInterval(intervalId)
      clearTimeout(timeoutId)
      unsubscribe?.()
    }
  }, [hasPending, maxWaitMs, pendingJobId, pendingSessionId, pollIntervalMs, repository])

  const beginWaitingAfterStop = useCallback(
    (targetSessionId: string, jobId: string | null, runtimeLabel?: string) => {
      setManualPending({
        sessionId: targetSessionId,
        jobId,
        reason: "stopping",
        runtimeLabel,
      })
    },
    []
  )

  const clearPendingTurn = useCallback(() => {
    setManualPending(null)
    setDetectedPending(null)
  }, [])

  return {
    pendingTurn,
    beginWaitingAfterStop,
    clearPendingTurn,
  }
}
