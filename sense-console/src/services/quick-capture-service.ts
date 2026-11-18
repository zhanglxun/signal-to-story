import { mapQuickCaptureResult, type QuickCaptureRequest, type QuickCaptureResult } from "@/contracts/quick-capture"
import { getSupabaseClient } from "@/lib/supabase"

const FRIENDLY: Array<[RegExp, string]> = [
  [/idempotency_conflict/, "这次提交与之前的同一请求内容不一致，请重新提交。"],
  [/rate_limited/, "提交过于频繁，请稍后再试。"],
  [/调度|权限|登录/, "当前账号没有收录或自动出稿权限。"],
]

/**
 * Atomic quick capture via the `quick_capture` RPC (RLS + permission checks in the database).
 * Same idempotency key -> same result (duplicate=true), never duplicate work items or jobs.
 */
export async function submitQuickCapture(input: QuickCaptureRequest): Promise<QuickCaptureResult> {
  const client = getSupabaseClient()
  if (!client) throw new Error("尚未配置云端连接")
  const { data, error } = await client.rpc("quick_capture", {
    p_organization_id: input.organizationId,
    p_url: input.url,
    p_note: input.note,
    p_intent: input.intent,
    p_platforms: input.intent === "auto_draft" ? input.platforms : [],
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) {
    const message = error.message ?? ""
    const friendly = FRIENDLY.find(([re]) => re.test(message))?.[1]
    throw new Error(friendly ?? (message.startsWith("invalid_input:") ? message.replace("invalid_input:", "").trim() : "收录失败，请稍后重试。"))
  }
  return mapQuickCaptureResult(data as Record<string, unknown>)
}
