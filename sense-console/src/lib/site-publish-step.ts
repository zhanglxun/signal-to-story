import type { ApprovalRequest } from '@/contracts/agent-job'

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
  approvals: ApprovalRequest[]
  /** content_documents.published_revision / published_at */
  publishedRevision?: number | null
  publishedAt?: string | null
  now?: number
}): SitePublishState {
  const now = input.now ?? Date.now()
  const forSite = input.approvals
  const current = forSite.filter(a => a.targetRevision === input.revision)
  const staleApprovals = forSite.some(a => a.targetRevision !== null && a.targetRevision < input.revision)
  const latest = current[0] ?? null // callers pass newest first
  const effective = latest && latest.status === 'approved' && Date.parse(latest.expiresAt) <= now ? { ...latest, status: 'expired' as const } : latest
  const lastOutcome = effective?.status === 'rejected' || effective?.status === 'expired' ? effective.status : null
  if (input.documentStatus !== 'approved') return { step: 'not_approved', approval: effective, staleApprovals, lastOutcome }
  const live = Boolean(input.publishedAt) && input.publishedRevision === input.revision
  if (live) return { step: 'published', approval: effective, staleApprovals, lastOutcome }
  if (effective?.status === 'approved') return { step: 'publish', approval: effective, staleApprovals, lastOutcome }
  if (effective?.status === 'pending') return { step: 'wait_decision', approval: effective, staleApprovals, lastOutcome }
  return { step: 'request', approval: effective, staleApprovals, lastOutcome }
}

/** Derive a DB-valid lowercase slug (^[a-z0-9]+(?:-[a-z0-9]+)*$) with ASCII/Chinese title fallback. */
export function suggestSiteSlug(title: string, documentId: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  if (ascii.length >= 3) return ascii
  const suffix = documentId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'draft'
  return `post-${suffix}`
}

/** Extract a 1–140 char plain-text reader summary from Markdown body (or fall back to title). */
export function suggestSiteSummary(body: string, title = ''): string {
  const stripInline = (text: string) =>
    text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/[*_~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  const withoutHeadings = stripInline(body.replace(/^#{1,6}\s+.*$/gm, ''))
  const plain = withoutHeadings || stripInline(body.replace(/^#{1,6}\s+/gm, ''))
  if (plain) return Array.from(plain).slice(0, 140).join('')
  return Array.from(title.trim()).slice(0, 140).join('')
}
