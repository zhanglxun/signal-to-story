// Review notifications to IM (Feishu card / WeCom group-robot Markdown) when a job needs a human.
// No-op unless the job came from an IM connection AND the matching push credentials are configured.
// Never throws: a failed notification must not fail or retry the job (business result and IM delivery
// are separate concerns). Cards contain LINK buttons only; approval happens in the console by a logged-in member.
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

type Target = {
  channel: "feishu" | "wecom"
  reply_target: string | null
  status: ReviewNotice["status"] | string
  rounds: number
  max_rounds?: number
  project_id?: string | null
  document_id?: string | null
  platform?: string | null
  title?: string | null
}

export type NotifyResult = { sent: boolean; reason?: string }

/**
 * Call when a job reaches pending_review or blocked_needs_human.
 * `summary` is optional free text (untrusted; it is clipped and escaped).
 */
export async function notifyJobNeedsHuman(deps: ImNotifyDeps, job: { id: string; status: string; summary?: string }): Promise<NotifyResult> {
  const log = deps.log ?? (() => {})
  try {
    if (job.status !== "pending_review" && job.status !== "blocked_needs_human") return { sent: false, reason: "status_not_notifiable" }
    const env = deps.env ?? (process.env as ImNotifyEnv)
    const feishuOn = !!(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET)
    const wecomOn = !!env.WECOM_NOTIFY_WEBHOOK_URL
    if (!feishuOn && !wecomOn) return { sent: false, reason: "not_configured" }
    const { data, error } = await deps.rpc("im_notify_target", { p_job_id: job.id })
    if (error) throw new Error(error.message)
    if (!data) return { sent: false, reason: "no_im_target" }
    const t = data as Target
    const base = env.CONSOLE_BASE_URL?.trim() || "https://story.susense.cn"
    const notice: ReviewNotice = {
      jobId: job.id,
      status: job.status,
      title: t.title ?? "",
      platform: t.platform,
      rounds: t.rounds,
      maxRounds: t.max_rounds,
      summary: job.summary,
      taskUrl: consoleUrl(base, `/tasks/${job.id}`),
      reviewUrl: consoleUrl(base, t.project_id ? `/content/projects/${t.project_id}` : `/tasks/${job.id}`),
    }
    const doFetch = deps.fetch ?? ((u, i) => fetch(u, i))
    if (t.channel === "feishu") {
      if (!feishuOn || !t.reply_target) return { sent: false, reason: "feishu_unavailable" }
      const sender = createFeishuSender({ appId: env.FEISHU_APP_ID!, appSecret: env.FEISHU_APP_SECRET!, fetch: doFetch })
      await sender.sendCard(t.reply_target, buildFeishuReviewCard(notice))
      return { sent: true }
    }
    if (!wecomOn) return { sent: false, reason: "wecom_unavailable" }
    await sendWecomGroupMarkdown(env.WECOM_NOTIFY_WEBHOOK_URL!, buildWecomReviewMarkdown(notice), doFetch)
    return { sent: true }
  } catch (error) {
    log("im_notify_failed", { job_id: job.id, error: error instanceof Error ? error.message : String(error) })
    return { sent: false, reason: "delivery_failed" }
  }
}
