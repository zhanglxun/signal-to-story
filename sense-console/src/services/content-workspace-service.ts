import type { ContentWorkspace } from "@/contracts/workspace"
import { getSupabaseClient } from "@/lib/supabase"

function requireSupabase() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 尚未配置。")
  return supabase
}

/**
 * Resolves the caller's primary organization and whether they hold the
 * `content.manage` permission there. Shared by every content-production
 * feature (assets, source categories, signals, selections, ...) so the
 * "find my org → find my membership → find my role's permissions" lookup
 * isn't duplicated per feature.
 */
export async function getContentWorkspace(): Promise<ContentWorkspace> {
  const supabase = requireSupabase()
  const { data: organizations, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)

  if (organizationError) throw new Error("暂时无法读取所属组织。")
  const organization = organizations?.[0] ?? null
  if (!organization) return { organization: null, canManage: false }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("登录会话已失效，请重新登录。")

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organization.id)
    .eq("user_id", userData.user.id)
    .maybeSingle()

  if (membershipError) throw new Error("暂时无法读取内容管理权限。")
  if (!membership) return { organization, canManage: false }

  const { data: roleDefinition, error: roleError } = await supabase
    .from("organization_roles")
    .select("permissions")
    .eq("organization_id", organization.id)
    .eq("role_key", membership.role)
    .maybeSingle()

  if (roleError) throw new Error("暂时无法读取内容管理权限。")

  return {
    organization,
    canManage: Boolean(roleDefinition?.permissions?.includes("content.manage")),
    canReview: Boolean(roleDefinition?.permissions?.includes("content.review")),
    canPublish: Boolean(roleDefinition?.permissions?.includes("content.publish")),
  }
}
