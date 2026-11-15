import type { ApprovalRequest } from '@/contracts/agent-job'
import type { SiteRelease } from '@/contracts/site-publish'
import { isLiveRelease } from '@/contracts/site-publish'

/** Next human action in the "publish to reader site" flow. Presentation only; the database enforces every rule. */
export type SitePublishStep = 'not_approved' | 'request' | 'wait_decision' | 'publish' | 'published'

export type SitePublishState = {
  step: SitePublishStep
  approval: ApprovalRequest | null
  /** Earlier-revision approvals existed and are no longer valid. */
  staleApprovals: boolean
  /** Latest approval for this revision was rejected or has expired. */
  lastOutcome: 'rejected' | 'expired' | null
}

export function sitePublishState(input: {
  documentStatus: string
  revision: number
  siteId: string
  approvals: ApprovalRequest[]
  releases: SiteRelease[]
  now?: number
}): SitePublishState {
  const now = input.now ?? Date.now()
  const forSite = input.approvals.filter(a => a.payload.site_id === input.siteId)
  const current = forSite.filter(a => a.targetRevision === input.revision)
  const staleApprovals = forSite.some(a => a.targetRevision !== null && a.targetRevision < input.revision)
  const latest = current[0] ?? null // callers pass newest first
  const effective = latest && latest.status === 'approved' && Date.parse(latest.expiresAt) <= now ? { ...latest, status: 'expired' as const } : latest
  const lastOutcome = effective?.status === 'rejected' || effective?.status === 'expired' ? effective.status : null
  if (input.documentStatus !== 'approved') return { step: 'not_approved', approval: effective, staleApprovals, lastOutcome }
  const live = input.releases.some(r => r.site_id === input.siteId && r.source_revision === input.revision && isLiveRelease(r))
  if (live) return { step: 'published', approval: effective, staleApprovals, lastOutcome }
  if (effective?.status === 'approved') return { step: 'publish', approval: effective, staleApprovals, lastOutcome }
  if (effective?.status === 'pending') return { step: 'wait_decision', approval: effective, staleApprovals, lastOutcome }
  return { step: 'request', approval: effective, staleApprovals, lastOutcome }
}
