import { useQuery } from "@tanstack/react-query"

import { listRuntimeCatalog } from "@/modules/chat/services/runtime-catalog-service"
import { getContentWorkspace } from "@/services/content-workspace-service"

/**
 * Node capability catalog for the configuration pages: every node of the caller's organization,
 * revoked ones included (shown greyed out). Refreshes every 30 s so the online state stays current.
 */
export function useRuntimeCatalog() {
  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace, retry: false })
  const organizationId = workspace.data?.organization?.id ?? null
  const catalog = useQuery({
    queryKey: ["runtime-catalog", organizationId, "with-revoked"],
    queryFn: () => listRuntimeCatalog(organizationId, { includeRevoked: true }),
    enabled: !workspace.isPending,
    refetchInterval: 30_000,
  })
  return { workspace, organizationId, catalog }
}
