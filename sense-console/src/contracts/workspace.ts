/**
 * Shared shape for "which organization am I in, and can I manage its
 * content" — every content-production feature (assets, source categories,
 * inbox, work items, ...) resolves this the same way before its own
 * feature-specific queries run.
 */
export type ContentWorkspace = {
  organization: {
    id: string
    name: string
  } | null
  canManage: boolean
  canReview?: boolean
  canPublish?: boolean
  /** agent.dispatch: enqueue, retry, resume, or cancel agent jobs. */
  canDispatch?: boolean
  /** organization.manage: execution nodes, storage, integrations. */
  canManageOrganization?: boolean
}
