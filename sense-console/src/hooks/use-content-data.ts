import { useQuery } from '@tanstack/react-query'
import { getContentWorkspace } from '@/services/content-workspace-service'
import { listChannels, listDocuments, listMetrics, listProjects, listPublications } from '@/services/content-service'

export function useContentData() {
  const workspace = useQuery({ queryKey: ['content-workspace'], queryFn: getContentWorkspace })
  const org = workspace.data?.organization?.id
  const content = useQuery({
    queryKey: ['cloud-content', org], enabled: Boolean(org),
    queryFn: async () => {
      const [projects, documents, channels, publications, metrics] = await Promise.all([
        listProjects(org!), listDocuments(org!), listChannels(org!), listPublications(org!), listMetrics(org!),
      ])
      return { projects, documents, channels, publications, metrics }
    },
  })
  return { workspace: workspace.data, data: content.data, error: workspace.error ?? content.error, loading: workspace.isLoading || (Boolean(org) && content.isLoading) }
}
