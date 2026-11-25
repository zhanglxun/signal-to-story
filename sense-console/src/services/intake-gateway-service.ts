import { generateIntakeCredential } from "@/lib/intake-credentials"
import { getSupabaseClient } from "@/lib/supabase"
export type IntakeConnection = {
  id: string
  name: string
  adapter: string
  created_at: string
  expires_at: string
  revoked_at: string | null
}
const columns = "id,name,adapter,created_at,expires_at,revoked_at"
function client() {
  const c = getSupabaseClient()
  if (!c) throw new Error("尚未配置云端连接")
  return c
}
export type IntakeAdapter = "dot" | "generic" | "feishu" | "wecom"

export function intakeEndpoint() {
  return `${import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "")}/functions/v1/intake-gateway`
}
export function imWebhookEndpoint(
  channel: "feishu" | "wecom",
  connectionId: string
) {
  return `${import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "")}/functions/v1/im-webhook/${channel}/${connectionId}`
}
export async function listIntakeConnections(
  org: string
): Promise<IntakeConnection[]> {
  const { data, error } = await client()
    .from("intake_connections")
    .select(columns)
    .eq("organization_id", org)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) throw new Error("无法读取接入配置，请确认接入层迁移已部署。")
  return data ?? []
}
export async function createIntakeConnection(
  org: string,
  name: string,
  adapter: IntakeAdapter
) {
  const { token, hash } = generateIntakeCredential()
  const { data, error } = await client()
    .from("intake_connections")
    .insert({
      organization_id: org,
      name: name.trim(),
      adapter,
      token_hash: hash,
    })
    .select(columns)
    .single()
  if (error) throw new Error("创建失败，请确认名称与内容管理权限。")
  const connection = data as IntakeConnection
  // An IM bot is just a connection with adapter feishu/wecom: the platform signs each request, and the
  // webhook path carries the connection id. No separate channel registration.
  if (adapter === "feishu" || adapter === "wecom") {
    const webhookUrl = imWebhookEndpoint(adapter, connection.id)
    return {
      connection,
      webhookUrl,
      config: JSON.stringify(
        { channel: adapter, connectionId: connection.id, webhookUrl },
        null,
        2
      ),
    }
  }
  return {
    connection,
    webhookUrl: null as string | null,
    config: JSON.stringify({ endpoint: intakeEndpoint(), token }, null, 2),
  }
}
export async function revokeIntakeConnection(id: string, org: string) {
  const { data, error } = await client()
    .from("intake_connections")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", org)
    .select("id")
  if (error || !data?.length) throw new Error("撤销失败，请检查权限。")
}
