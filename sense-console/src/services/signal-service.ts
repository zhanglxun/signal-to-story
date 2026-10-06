import type {
  CreateSignalInput,
  Signal,
  SignalFilters,
  SignalPage,
  UpdateSignalInput,
} from "@/contracts/signal"
import { getSupabaseClient } from "@/lib/supabase"

type SignalRow = {
  id: number
  organization_id: string
  category_id: number
  name: string
  icon_url: string | null
  site_url: string | null
  summary: string | null
  description: string | null
  is_organized: boolean
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

const columns = "id, organization_id, category_id, name, icon_url, site_url, summary, description, is_organized, created_by, created_at, updated_by, updated_at"
const DEFAULT_PAGE_SIZE = 10

function requireSupabase() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 尚未配置。")
  return supabase
}

function mapSignal(row: SignalRow): Signal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    categoryId: row.category_id,
    name: row.name,
    iconUrl: row.icon_url,
    siteUrl: row.site_url,
    summary: row.summary,
    description: row.description,
    isOrganized: row.is_organized,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

export async function getSignalsPage(filters: SignalFilters): Promise<SignalPage> {
  const supabase = requireSupabase()
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = Math.max(1, filters.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let request = supabase
    .from("signals")
    .select(columns, { count: "exact" })
    .eq("organization_id", filters.organizationId)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (typeof filters.categoryId === "number") request = request.eq("category_id", filters.categoryId)

  const normalizedQuery = filters.query?.trim()
  if (normalizedQuery) {
    const pattern = normalizedQuery.replaceAll("%", "\\%").replaceAll("_", "\\_")
    request = request.ilike("name", `%${pattern}%`)
  }

  const { data, error, count } = await request
  if (error) throw new Error("暂时无法读取待处理信息列表。")
  return {
    signals: ((data ?? []) as unknown as SignalRow[]).map(mapSignal),
    totalCount: count ?? 0,
  }
}

export async function createSignal(input: CreateSignalInput): Promise<Signal> {
  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("登录会话已失效，请重新登录。")

  const trimOrNull = (value?: string) => value?.trim() || null
  const { data, error } = await supabase
    .from("signals")
    .insert({
      organization_id: input.organizationId,
      category_id: input.categoryId,
      name: input.name.trim(),
      icon_url: trimOrNull(input.iconUrl),
      site_url: trimOrNull(input.siteUrl),
      summary: trimOrNull(input.summary),
      description: trimOrNull(input.description),
      is_organized: input.isOrganized,
      created_by: userData.user.id,
      updated_by: userData.user.id,
    })
    .select(columns)
    .single()

  if (error) throw new Error("待处理信息登记失败，请检查字段和当前账号权限。")
  return mapSignal(data as unknown as SignalRow)
}

export async function updateSignal(input: UpdateSignalInput): Promise<Signal> {
  const supabase = requireSupabase()
  const trimOrNull = (value?: string) => value?.trim() || null
  const { data, error } = await supabase
    .from("signals")
    .update({
      category_id: input.categoryId,
      name: input.name.trim(),
      icon_url: trimOrNull(input.iconUrl),
      site_url: trimOrNull(input.siteUrl),
      summary: trimOrNull(input.summary),
      description: trimOrNull(input.description),
      is_organized: input.isOrganized,
    })
    .eq("id", input.id)
    .eq("organization_id", input.organizationId)
    .select(columns)
    .single()

  if (error) throw new Error("待处理信息更新失败，请检查字段和当前账号权限。")
  return mapSignal(data as unknown as SignalRow)
}

/** Lightweight option list for the selection dialog's "关联信息" picker — not paginated, capped at a generous limit. */
export async function getSignalOptions(organizationId: string): Promise<{ id: number; name: string }[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from("signals")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) throw new Error("暂时无法读取待处理信息列表。")
  return (data ?? []) as { id: number; name: string }[]
}

export async function deleteSignal(id: number, organizationId: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from("signals")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId)

  if (error) {
    if (error.code === "23503") throw new Error("该信息已被选题引用，请先处理关联选题再删除。")
    throw new Error("待处理信息删除失败，请检查当前账号权限。")
  }
}

export async function getSignal(id: number): Promise<Signal | null> {
  const { data, error } = await requireSupabase().from("signals").select(columns).eq("id", id).maybeSingle()
  if (error) throw new Error("暂时无法读取来源信息。")
  return data ? mapSignal(data as unknown as SignalRow) : null
}
