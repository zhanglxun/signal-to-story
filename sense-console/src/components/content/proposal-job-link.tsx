import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { listJobUsage } from "@/services/agent-job-service"

/** Display-only provenance for an AI proposal produced by an agent task: link to /tasks/:id and show evaluated rounds (from its steps). */
export function ProposalJobLink({ jobId }: { jobId: string }) {
  const usage = useQuery({ queryKey: ["agent-job", jobId, "usage"], queryFn: () => listJobUsage([jobId]) })
  const rounds = usage.data?.[jobId]?.rounds
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      来自任务{rounds != null && rounds > 0 ? `，评估了 ${rounds} 轮` : ""} ·{" "}
      <Link to={`/tasks/${jobId}`} className="underline underline-offset-2">查看任务</Link>
    </p>
  )
}
