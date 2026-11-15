import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { getAgentJob } from "@/services/agent-job-service"

/** Display-only provenance for an AI proposal produced by an agent task: link to /tasks/:id and show evaluated rounds. */
export function ProposalJobLink({ jobId }: { jobId: string }) {
  const job = useQuery({ queryKey: ["agent-job", jobId], queryFn: () => getAgentJob(jobId) })
  const rounds = job.data?.rounds
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      来自任务{rounds != null && rounds > 0 ? `，评估了 ${rounds} 轮` : ""} ·{" "}
      <Link to={`/tasks/${jobId}`} className="underline underline-offset-2">查看任务</Link>
    </p>
  )
}
