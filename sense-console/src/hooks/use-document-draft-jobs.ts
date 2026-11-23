import { useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import type { ContentDocument } from "@/contracts/content"
import { listAgentJobs } from "@/services/agent-job-service"

export function useDocumentDraftJobs(
  document: Pick<ContentDocument, "id" | "organization_id" | "revision">,
  trackedJobId: string | null = null
) {
  const queryClient = useQueryClient()
  const enabled = Boolean(document.id && document.organization_id)
  const draftJobs = useQuery({
    queryKey: ["agent-jobs", "document", document.id],
    enabled,
    queryFn: () =>
      listAgentJobs({
        organizationId: document.organization_id,
        kind: "content_draft",
        targetId: document.id,
        limit: 10,
      }),
    refetchInterval: (query) => {
      const jobs = query.state.data ?? []
      if (jobs.some((j) => j.status === "queued" || j.status === "running"))
        return 4000
      if (
        trackedJobId &&
        !jobs.some(
          (j) =>
            j.id === trackedJobId &&
            j.status !== "queued" &&
            j.status !== "running"
        )
      ) {
        return 4000
      }
      return false
    },
  })

  const latestWrittenRevision = Math.max(
    0,
    ...(draftJobs.data ?? []).map((j) =>
      typeof j.result?.written_revision === "number"
        ? j.result.written_revision
        : 0
    )
  )

  useEffect(() => {
    if (latestWrittenRevision > document.revision) {
      void queryClient.invalidateQueries({ queryKey: ["work-item"] })
      void queryClient.invalidateQueries({ queryKey: ["cloud-content"] })
      void queryClient.invalidateQueries({
        queryKey: ["document-history", document.id],
      })
    }
  }, [latestWrittenRevision, document.revision, document.id, queryClient])

  return draftJobs
}
