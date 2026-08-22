import type {
  CreateOrganizationAccountInput,
  OrganizationAccount,
  OrganizationAccountsResult,
  OrganizationRoleDefinition,
  OrganizationRolesResult,
  OrganizationSummary,
} from "@/contracts/organization"
import { getSupabaseClient } from "@/lib/supabase"

type MemberRow = {
  user_id: string
  role: OrganizationAccount["role"]
  created_at: string
  profiles: {
    email: string
    display_name: string
    status: OrganizationAccount["status"]
  } | null
}

type RoleRow = {
  role_key: string
  name: string
  description: string
  permissions: string[]
  assignment_permission: string
  is_system: boolean
  is_assignable: boolean
  sort_order: number
}

function requireSupabase() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 尚未配置。")
  return supabase
}

async function getPrimaryOrganization(): Promise<OrganizationSummary | null> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug, domain")
    .order("created_at", { ascending: true })
    .limit(1)

  if (error) throw new Error("暂时无法读取组织信息。")
  return data?.[0] ?? null
}

function mapRole(row: RoleRow): OrganizationRoleDefinition {
  return {
    key: row.role_key,
    name: row.name,
    description: row.description,
    permissions: row.permissions,
    assignmentPermission: row.assignment_permission,
    isSystem: row.is_system,
    isAssignable: row.is_assignable,
    sortOrder: row.sort_order,
  }
}

async function getRolesForOrganization(organizationId: string) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from("organization_roles")
    .select("role_key, name, description, permissions, assignment_permission, is_system, is_assignable, sort_order")
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })

  if (error) throw new Error("暂时无法读取角色列表。")
  return ((data ?? []) as RoleRow[]).map(mapRole)
}

export async function getOrganizationRoles(): Promise<OrganizationRolesResult> {
  const organization = await getPrimaryOrganization()
  if (!organization) return { organization: null, roles: [] }

  return {
    organization,
    roles: await getRolesForOrganization(organization.id),
  }
}

export async function getOrganizationAccounts(): Promise<OrganizationAccountsResult> {
  const organization = await getPrimaryOrganization()
  if (!organization) return { organization: null, accounts: [], roles: [] }

  const supabase = requireSupabase()
  const rolesPromise = getRolesForOrganization(organization.id)
  const { data, error } = await supabase
    .from("organization_members")
    .select("user_id, role, created_at, profiles!inner(email, display_name, status)")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: true })

  if (error) throw new Error("暂时无法读取账号列表。")

  const roles = await rolesPromise

  const accounts = ((data ?? []) as unknown as MemberRow[])
    .filter((row) => row.profiles)
    .map((row) => ({
      id: row.user_id,
      email: row.profiles!.email,
      displayName: row.profiles!.display_name,
      role: row.role,
      status: row.profiles!.status,
      createdAt: row.created_at,
    }))

  return { organization, accounts, roles }
}

export async function createOrganizationAccount(input: CreateOrganizationAccountInput) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.functions.invoke("admin-create-account", {
    body: input,
  })

  if (error) {
    let message = "账号创建失败，请稍后重试。"
    if ("context" in error && error.context instanceof Response) {
      try {
        const payload = await error.context.clone().json() as { message?: unknown }
        if (typeof payload.message === "string") message = payload.message
      } catch {
        // Keep the safe fallback message when the response is not JSON.
      }
    }
    throw new Error(message)
  }

  return data as { account: OrganizationAccount }
}
