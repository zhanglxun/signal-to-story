// Polling notifier (docs/database.md §4.4, R4 — replaces an outbox). The node asks the database for
// everything that needs a human and has not been announced yet (jobs in pending_review / blocked_needs_human /
// failed, pending approval requests and agent questions), sends an IM notice to the conversation the work came
// from (intake_events.payload.reply_to), then marks it notified_at. A failed send is NOT marked, so the next
// poll retries it. Notices without a reachable IM target are marked as handled (nothing to deliver).
// Cards contain LINK buttons only; approving and answering happen in the console by a logged-in member.
import { buildFeishuReviewCard, createFeishuSender, type FetchLike } from "../../../supabase/functions/_shared/im/feishu.ts"
import { consoleUrl, type ReviewNotice } from "../../../supabase/functions/_shared/im/shared.ts"
import { buildWecomReviewMarkdown, sendWecomGroupMarkdown, type WecomFetch } from "../../../supabase/functions/_shared/im/wecom.ts"

export type NotifyRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

export type ImNotifyEnv = {
  CONSOLE_BASE_URL?: string
  FEISHU_APP_ID?: string
  FEISHU_APP_SECRET?: string
  /** WeCom group-robot webhook URL (contains its key: treat as a secret). */
  WECOM_NOTIFY_WEBHOOK_URL?: string
}

export type ImNotifyDeps = {
  rpc: NotifyRpc
  env?: ImNotifyEnv
  fetch?: FetchLike & WecomFetch
  log?: (event: string, fields: Record<string, unknown>) => void
}

/** One row of public.list_pending_notices(). */
export type PendingNotice = {
  kind: "job" | "approval" | "question"
  id: string
  organization_id: string
  status: string
  job_id?: string | null
  job_kind?: string | null
  error_code?: string | null
  work_item_id?: string | null
  document_id?: string | null
  platform?: string | null
  title?: string | null
  summary?: string | null
  action?: string | null
  rounds?: number | null
  max_rounds?: number | null
  reply_to?: { channel: string; target: string | null; connection_id?: string } | null
}

export type NoticeOutcome = { id: string; kind: PendingNotice["kind"]; result: "sent" | "skipped" | "failed"; reason?: string }

function toReviewNotice(n: PendingNotice, base: string): ReviewNotice {
  const status: ReviewNotice["status"] = n.kind === "job" ? (n.status as ReviewNotice["status"]) : n.kind
  const jobPath = n.job_id ? `/tasks/${n.job_id}` : "/tasks"
  return {
    jobId: n.job_id ?? n.id,
    status,
    title: n.title ?? "",
    platform: n.platform,
    rounds: n.rounds ?? 0,
    maxRounds: n.max_rounds ?? undefined,
    summary: n.kind === "job" ? undefined : (n.summary ?? undefined),
    taskUrl: consoleUrl(base, jobPath),
    reviewUrl: consoleUrl(base, n.work_item_id ? `/work-items/${n.work_item_id}` : n.kind === "job" ? jobPath : "/tasks"),
  }
}

/** Deliver one notice. Throws on a delivery failure; returns a skip reason when there is nothing to deliver. */
async function deliver(deps: ImNotifyDeps, env: ImNotifyEnv, n: PendingNotice): Promise<{ sent: boolean; reason?: string }> {
  const to = n.reply_to
  if (!to || (to.channel !== "feishu" && to.channel !== "wecom")) return { sent: false, reason: "no_im_target" }
  const notice = toReviewNotice(n, env.CONSOLE_BASE_URL?.trim() || "https://story.susense.cn")
  const doFetch = deps.fetch ?? ((u, i) => fetch(u, i))
  if (to.channel === "feishu") {
    if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !to.target) return { sent: false, reason: "feishu_unavailable" }
    const sender = createFeishuSender({ appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET, fetch: doFetch })
    await sender.sendCard(to.target, buildFeishuReviewCard(notice))
    return { sent: true }
  }
  if (!env.WECOM_NOTIFY_WEBHOOK_URL) return { sent: false, reason: "wecom_unavailable" }
  await sendWecomGroupMarkdown(env.WECOM_NOTIFY_WEBHOOK_URL, buildWecomReviewMarkdown(notice), doFetch)
  return { sent: true }
}

/**
 * One notifier poll. Never throws: listing errors are logged and the poll returns []. Each notice is marked only
 * after a successful send (or when it has no deliverable target); failed sends stay unmarked and retry next poll.
 */
export async function runNotifierOnce(deps: ImNotifyDeps, limit = 50): Promise<NoticeOutcome[]> {
  const log = deps.log ?? (() => {})
  const env = deps.env ?? (process.env as ImNotifyEnv)
  let notices: PendingNotice[]
  try {
    const { data, error } = await deps.rpc("list_pending_notices", { p_limit: limit })
    if (error) throw new Error(error.message)
    notices = Array.isArray(data) ? (data as PendingNotice[]) : []
  } catch (error) {
    log("notice_list_failed", { error: error instanceof Error ? error.message : String(error) })
    return []
  }
  const outcomes: NoticeOutcome[] = []
  for (const n of notices) {
    let outcome: NoticeOutcome
    try {
      const r = await deliver(deps, env, n)
      outcome = { id: n.id, kind: n.kind, result: r.sent ? "sent" : "skipped", reason: r.reason }
    } catch (error) {
      log("im_notify_failed", { notice: n.kind, id: n.id, error: error instanceof Error ? error.message : String(error) })
      outcomes.push({ id: n.id, kind: n.kind, result: "failed", reason: "delivery_failed" })
      continue
    }
    try {
      const marked = await deps.rpc("mark_notice_sent", { p_kind: n.kind, p_id: n.id, p_status: n.status })
      if (marked.error) throw new Error(marked.error.message)
    } catch (error) {
      // Sent but not marked: the next poll may send it once more (at-least-once delivery).
      log("notice_mark_failed", { notice: n.kind, id: n.id, error: error instanceof Error ? error.message : String(error) })
    }
    outcomes.push(outcome)
  }
  return outcomes
}
