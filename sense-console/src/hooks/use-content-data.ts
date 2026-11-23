import { useQuery } from '@tanstack/react-query'
import { getContentWorkspace } from '@/services/content-workspace-service'
import { listDocuments } from '@/services/content-service'
import { listWorkItems } from '@/services/work-item-service'

export function useContentData() {
  const workspace = useQuery({ queryKey: ['content-workspace'], queryFn: getContentWorkspace })
  const org = workspace.data?.organization?.id
  const content = useQuery({
    queryKey: ['cloud-content', org], enabled: Boolean(org),
    queryFn: async () => {
      const [workItems, documents] = await Promise.all([listWorkItems(org!), listDocuments(org!)])
      return { workItems, documents }
    },
  })
  return { workspace: workspace.data, data: content.data, error: workspace.error ?? content.error, loading: workspace.isLoading || (Boolean(org) && content.isLoading) }
}
