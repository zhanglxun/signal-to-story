import type {
  CreateSourceCategoryInput,
  SourceCategory,
  UpdateSourceCategoryInput,
} from "@/contracts/source-category"
import { getSupabaseClient } from "@/lib/supabase"

type SourceCategoryRow = {
  id: number
  organization_id: string
  parent_id: number | null
  name: string
  icon_url: string | null
  sort_order: number
  is_active: boolean
  description: string | null
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

const columns = "id, organization_id, parent_id, name, icon_url, sort_order, is_active, description, created_by, created_at, updated_by, updated_at"

function requireSupabase() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 尚未配置。")
  return supabase
}

function mapSourceCategory(row: SourceCategoryRow): SourceCategory {
  return {
    id: row.id,
    organizationId: row.organization_id,
    parentId: row.parent_id,
    name: row.name,
    iconUrl: row.icon_url,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

/** Loaded once, in full, and nested into a tree client-side — this is a small config-like list, not a paginated feed. */
export async function getSourceCategories(organizationId: string): Promise<SourceCategory[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from("source_categories")
    .select(columns)
    .eq("organization_id", organizationId)
    .order("sort_order", { ascending: true })

  if (error) throw new Error("暂时无法读取分类列表。")
  return ((data ?? []) as unknown as SourceCategoryRow[]).map(mapSourceCategory)
}

export async function createSourceCategory(input: CreateSourceCategoryInput): Promise<SourceCategory> {
  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("登录会话已失效，请重新登录。")

  const trimOrNull = (value?: string) => value?.trim() || null
  const { data, error } = await supabase
    .from("source_categories")
    .insert({
      organization_id: input.organizationId,
      parent_id: input.parentId,
      name: input.name.trim(),
      icon_url: trimOrNull(input.iconUrl),
      sort_order: input.sortOrder,
      is_active: input.isActive,
      description: trimOrNull(input.description),
      created_by: userData.user.id,
      updated_by: userData.user.id,
    })
    .select(columns)
    .single()

  if (error) {
    if (error.code === "23514") throw new Error("分类最多支持两层：目标上级本身是子分类，或该分类下已有子分类。")
    throw new Error("分类创建失败，请检查字段和当前账号权限。")
  }
  return mapSourceCategory(data as unknown as SourceCategoryRow)
}

export async function updateSourceCategory(input: UpdateSourceCategoryInput): Promise<SourceCategory> {
  const supabase = requireSupabase()
  const trimOrNull = (value?: string) => value?.trim() || null
  const { data, error } = await supabase
    .from("source_categories")
    .update({
      parent_id: input.parentId,
      name: input.name.trim(),
      icon_url: trimOrNull(input.iconUrl),
      sort_order: input.sortOrder,
      is_active: input.isActive,
      description: trimOrNull(input.description),
    })
    .eq("id", input.id)
    .eq("organization_id", input.organizationId)
    .select(columns)
    .single()

  if (error) {
    if (error.code === "23514") throw new Error("分类最多支持两层：目标上级本身是子分类，或该分类下已有子分类。")
    throw new Error("分类更新失败，请检查字段和当前账号权限。")
  }
  return mapSourceCategory(data as unknown as SourceCategoryRow)
}

export async function deleteSourceCategory(id: number, organizationId: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from("source_categories")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId)

  if (error) {
    if (error.code === "23503") throw new Error("请先移除该分类下的子分类，或解除待处理信息对它的引用，再删除。")
    throw new Error("分类删除失败，请检查当前账号权限。")
  }
}
