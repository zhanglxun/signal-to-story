/**
 * Shared shape for "which organization am I in, and can I manage its
 * content" — every content-production feature (assets, source categories,
 * signals, selections, ...) resolves this the same way before its own
 * feature-specific queries run.
 */
export type ContentWorkspace = {
  organization: {
    id: string
    name: string
  } | null
  canManage: boolean
}
