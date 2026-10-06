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
export type IntakeReceipt = {
  id: string
  connection_id: string
  external_id: string
  selection_id: number
  signal_id: number
  created_at: string
  payload: { text: string; title: string; url: string }
}
const columns = "id,name,adapter,created_at,expires_at,revoked_at"
function client() {
  const c = getSupabaseClient()
  if (!c) throw new Error("尚未配置云端连接")
  return c
}
export function intakeEndpoint() {
  return `${import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "")}/functions/v1/intake-gateway`
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
export async function listIntakeReceipts(
  org: string
): Promise<IntakeReceipt[]> {
  const { data, error } = await client()
    .from("intake_receipts")
    .select(
      "id,connection_id,external_id,selection_id,signal_id,created_at,payload"
    )
    .eq("organization_id", org)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) throw new Error("无法读取收录记录。")
  return (data ?? []) as IntakeReceipt[]
}
export async function createIntakeConnection(
  org: string,
  name: string,
  adapter: "dot" | "generic"
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
  return {
    connection: data as IntakeConnection,
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
