import type {
  CreateSelectionInput,
  OutlineTemplateItem,
  Selection,
  SelectionFilters,
  SelectionPage,
  SelectionPriority,
  UpdateSelectionInput,
} from "@/contracts/selection"
import { getSupabaseClient } from "@/lib/supabase"

type SelectionRow = {
  id: number
  organization_id: string
  signal_id: number
  name: string
  core_thesis: string | null
  angle_type: string | null
  content_format: string | null
  negative_prompts: string | null
  outline_template: unknown
  priority: number
  is_completed: boolean
  description: string | null
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
  signals: { name: string } | null
}

const columns = "id, organization_id, signal_id, name, core_thesis, angle_type, content_format, negative_prompts, outline_template, priority, is_completed, description, created_by, created_at, updated_by, updated_at, signals(name)"
const DEFAULT_PAGE_SIZE = 10

function requireSupabase() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 尚未配置。")
  return supabase
}

function toOutlineTemplate(value: unknown): OutlineTemplateItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is { title: unknown } => typeof item === "object" && item !== null && "title" in item)
    .map((item) => ({ title: String(item.title) }))
}

function mapSelection(row: SelectionRow): Selection {
  return {
    id: row.id,
    organizationId: row.organization_id,
    signalId: row.signal_id,
    name: row.name,
    coreThesis: row.core_thesis,
    angleType: row.angle_type,
    contentFormat: row.content_format,
    negativePrompts: row.negative_prompts,
    outlineTemplate: toOutlineTemplate(row.outline_template),
    priority: row.priority as SelectionPriority,
    isCompleted: row.is_completed,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    signalName: row.signals?.name,
  }
}

export async function getSelectionsPage(filters: SelectionFilters): Promise<SelectionPage> {
  const supabase = requireSupabase()
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = Math.max(1, filters.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from("selections")
    .select(columns, { count: "exact" })
    .eq("organization_id", filters.organizationId)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) throw new Error("暂时无法读取选题列表。")
  return {
    selections: ((data ?? []) as unknown as SelectionRow[]).map(mapSelection),
    totalCount: count ?? 0,
  }
}

export async function getSelection(id: number): Promise<Selection | null> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from("selections")
    .select(columns)
    .eq("id", id)
    .maybeSingle()

  if (error) throw new Error("暂时无法读取选题详情。")
  return data ? mapSelection(data as unknown as SelectionRow) : null
}

export async function createSelection(input: CreateSelectionInput): Promise<Selection> {
  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("登录会话已失效，请重新登录。")

  const trimOrNull = (value?: string) => value?.trim() || null
  const { data, error } = await supabase
    .from("selections")
    .insert({
      organization_id: input.organizationId,
      signal_id: input.signalId,
      name: input.name.trim(),
      core_thesis: trimOrNull(input.coreThesis),
      angle_type: trimOrNull(input.angleType),
      content_format: trimOrNull(input.contentFormat),
      negative_prompts: trimOrNull(input.negativePrompts),
      outline_template: input.outlineTemplate.filter((item) => item.title.trim()),
      priority: input.priority,
      is_completed: input.isCompleted,
      description: trimOrNull(input.description),
      created_by: userData.user.id,
      updated_by: userData.user.id,
    })
    .select(columns)
    .single()

  if (error) throw new Error("选题创建失败，请检查字段和当前账号权限。")
  return mapSelection(data as unknown as SelectionRow)
}

export async function updateSelection(input: UpdateSelectionInput): Promise<Selection> {
  const supabase = requireSupabase()
  const trimOrNull = (value?: string) => value?.trim() || null
  const { data, error } = await supabase
    .from("selections")
    .update({
      signal_id: input.signalId,
      name: input.name.trim(),
      core_thesis: trimOrNull(input.coreThesis),
      angle_type: trimOrNull(input.angleType),
      content_format: trimOrNull(input.contentFormat),
      negative_prompts: trimOrNull(input.negativePrompts),
      outline_template: input.outlineTemplate.filter((item) => item.title.trim()),
      priority: input.priority,
      is_completed: input.isCompleted,
      description: trimOrNull(input.description),
    })
    .eq("id", input.id)
    .eq("organization_id", input.organizationId)
    .select(columns)
    .single()

  if (error) throw new Error("选题更新失败，请检查字段和当前账号权限。")
  return mapSelection(data as unknown as SelectionRow)
}

export async function deleteSelection(id: number, organizationId: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from("selections")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId)

  if (error) throw new Error("选题删除失败，请检查当前账号权限。")
}
