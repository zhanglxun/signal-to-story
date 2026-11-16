import type {
  CreateOrganizationAccountInput,
  ListPageParams,
  OrganizationAccount,
  OrganizationAccountsPage,
  OrganizationAccountsWorkspace,
  OrganizationRoleDefinition,
  OrganizationRolesResult,
  OrganizationSummary,
} from "@/contracts/organization"
import { getSupabaseClient } from "@/lib/supabase"

const DEFAULT_ACCOUNTS_PAGE_SIZE = 10

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

function mapMember(row: MemberRow): OrganizationAccount | null {
  if (!row.profiles) return null
  return {
    id: row.user_id,
    email: row.profiles.email,
    displayName: row.profiles.display_name,
    role: row.role,
    status: row.profiles.status,
    createdAt: row.created_at,
  }
}

const memberColumns = "user_id, role, created_at, profiles!inner(email, display_name, status)"

async function getMembershipAccount(organizationId: string, userId: string): Promise<OrganizationAccount | null> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from("organization_members")
    .select(memberColumns)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw new Error("暂时无法读取当前账号信息。")
  return data ? mapMember(data as unknown as MemberRow) : null
}

export async function getOrganizationRoles(): Promise<OrganizationRolesResult> {
  const organization = await getPrimaryOrganization()
  if (!organization) return { organization: null, roles: [] }

  return {
    organization,
    roles: await getRolesForOrganization(organization.id),
  }
}

/**
 * Everything the accounts page needs *besides* the paginated account rows:
 * the organization, the full (small, config-like) role list used to name
 * roles and populate the "grant a role" dropdown, and the signed-in user's
 * own membership — resolved directly rather than by scanning a page of
 * accounts, so permission checks stay correct no matter which page of the
 * member list is currently displayed.
 */
export async function getOrganizationAccountsWorkspace(): Promise<OrganizationAccountsWorkspace> {
  const organization = await getPrimaryOrganization()
  if (!organization) return { organization: null, roles: [], currentAccount: null }

  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("登录会话已失效，请重新登录。")

  const [roles, currentAccount] = await Promise.all([
    getRolesForOrganization(organization.id),
    getMembershipAccount(organization.id, userData.user.id),
  ])

  return { organization, roles, currentAccount }
}

export async function getOrganizationAccountsPage(
  params: ListPageParams & { organizationId: string },
): Promise<OrganizationAccountsPage> {
  const supabase = requireSupabase()
  const pageSize = params.pageSize ?? DEFAULT_ACCOUNTS_PAGE_SIZE
  const page = Math.max(1, params.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from("organization_members")
    .select(memberColumns, { count: "exact" })
    .eq("organization_id", params.organizationId)
    .order("created_at", { ascending: true })
    .range(from, to)

  if (error) throw new Error("暂时无法读取账号列表。")

  const accounts = ((data ?? []) as unknown as MemberRow[])
    .map(mapMember)
    .filter((account): account is OrganizationAccount => account !== null)

  return { accounts, totalCount: count ?? 0 }
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
