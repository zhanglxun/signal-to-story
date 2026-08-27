import type {
  CreatePromptExampleInput,
  PromptExample,
  PromptExampleFilters,
  PromptExamplePage,
  UpdatePromptExampleInput,
} from "@/contracts/prompt-example"
import { getSupabaseClient } from "@/lib/supabase"

type PromptExampleRow = {
  id: number
  organization_id: string
  title: string
  prompt_text: string
  negative_prompt: string | null
  example_image_url: string | null
  example_storage_path: string | null
  example_asset_id: number | null
  source_url: string | null
  source_author: string | null
  origin_type: PromptExample["originType"]
  tags: string[]
  status: PromptExample["status"]
  visibility: PromptExample["visibility"]
  notes: string | null
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

const columns = "id, organization_id, title, prompt_text, negative_prompt, example_image_url, example_storage_path, example_asset_id, source_url, source_author, origin_type, tags, status, visibility, notes, created_by, created_at, updated_by, updated_at"
const DEFAULT_PAGE_SIZE = 10

function requireSupabase() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 尚未配置。")
  return supabase
}

function mapPromptExample(row: PromptExampleRow, examplePreviewUrl: string | null = null): PromptExample {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    promptText: row.prompt_text,
    negativePrompt: row.negative_prompt,
    exampleImageUrl: row.example_image_url,
    exampleStoragePath: row.example_storage_path,
    examplePreviewUrl: examplePreviewUrl ?? row.example_image_url,
    exampleAssetId: row.example_asset_id,
    sourceUrl: row.source_url,
    sourceAuthor: row.source_author,
    originType: row.origin_type,
    tags: row.tags ?? [],
    status: row.status,
    visibility: row.visibility,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

async function withImagePreviewUrls(rows: PromptExampleRow[]): Promise<PromptExample[]> {
  const paths = [...new Set(rows.map((row) => row.example_storage_path).filter((path): path is string => Boolean(path)))]
  if (paths.length === 0) return rows.map((row) => mapPromptExample(row))

  const supabase = requireSupabase()
  const { data } = await supabase.storage.from("prompt-examples").createSignedUrls(paths, 60 * 60)
  const urls = new Map(data?.map((item) => [item.path, item.signedUrl]) ?? [])
  return rows.map((row) => mapPromptExample(row, row.example_storage_path ? urls.get(row.example_storage_path) ?? null : null))
}

function trimOrNull(value?: string) {
  return value?.trim() || null
}

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12)
}

export async function getPromptExamplesPage(filters: PromptExampleFilters): Promise<PromptExamplePage> {
  const supabase = requireSupabase()
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const page = Math.max(1, filters.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let request = supabase
    .from("prompt_examples")
    .select(columns, { count: "exact" })
    .eq("organization_id", filters.organizationId)
    .order("updated_at", { ascending: false })
    .range(from, to)

  if (filters.originType) request = request.eq("origin_type", filters.originType)
  if (filters.status) request = request.eq("status", filters.status)

  const normalizedQuery = filters.query?.trim()
  if (normalizedQuery) {
    const pattern = normalizedQuery.replaceAll("%", "\\%").replaceAll("_", "\\_")
    request = request.or(`title.ilike.%${pattern}%,prompt_text.ilike.%${pattern}%`)
  }

  const { data, error, count } = await request
  if (error) throw new Error("暂时无法读取提示词与图例列表。")
  return {
    promptExamples: await withImagePreviewUrls((data ?? []) as unknown as PromptExampleRow[]),
    totalCount: count ?? 0,
  }
}

export async function createPromptExample(input: CreatePromptExampleInput): Promise<PromptExample> {
  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("登录会话已失效，请重新登录。")

  const { data, error } = await supabase
    .from("prompt_examples")
    .insert({
      organization_id: input.organizationId,
      title: input.title.trim(),
      prompt_text: input.promptText.trim(),
      negative_prompt: trimOrNull(input.negativePrompt),
      example_image_url: trimOrNull(input.exampleImageUrl),
      example_storage_path: input.exampleStoragePath ?? null,
      example_asset_id: input.exampleAssetId ?? null,
      source_url: trimOrNull(input.sourceUrl),
      source_author: trimOrNull(input.sourceAuthor),
      origin_type: input.originType,
      tags: normalizeTags(input.tags),
      status: input.status,
      visibility: input.visibility,
      notes: trimOrNull(input.notes),
      created_by: userData.user.id,
      updated_by: userData.user.id,
    })
    .select(columns)
    .single()

  if (error) throw new Error("提示词与图例登记失败，请检查字段和当前账号权限。")
  return mapPromptExample(data as unknown as PromptExampleRow)
}

export async function updatePromptExample(input: UpdatePromptExampleInput): Promise<PromptExample> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from("prompt_examples")
    .update({
      title: input.title.trim(),
      prompt_text: input.promptText.trim(),
      negative_prompt: trimOrNull(input.negativePrompt),
      example_image_url: trimOrNull(input.exampleImageUrl),
      example_storage_path: input.exampleStoragePath ?? null,
      example_asset_id: input.exampleAssetId ?? null,
      source_url: trimOrNull(input.sourceUrl),
      source_author: trimOrNull(input.sourceAuthor),
      origin_type: input.originType,
      tags: normalizeTags(input.tags),
      status: input.status,
      visibility: input.visibility,
      notes: trimOrNull(input.notes),
    })
    .eq("id", input.id)
    .eq("organization_id", input.organizationId)
    .select(columns)
    .single()

  if (error) throw new Error("提示词与图例更新失败，请检查字段和当前账号权限。")
  return mapPromptExample(data as unknown as PromptExampleRow)
}

const imageMimeExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

export async function uploadPromptExampleImage(organizationId: string, file: File): Promise<string> {
  const extension = imageMimeExtensions[file.type]
  if (!extension) throw new Error("仅支持 JPG、PNG、WebP 或 GIF 图片。")
  if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10MB。")

  const supabase = requireSupabase()
  const path = `${organizationId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from("prompt-examples").upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error("图片上传失败，请检查当前账号权限或稍后重试。")
  return path
}

export async function deletePromptExampleImage(path: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase.storage.from("prompt-examples").remove([path])
  if (error) throw new Error("旧图片清理失败。")
}

export async function deletePromptExample(id: number, organizationId: string): Promise<void> {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from("prompt_examples")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId)

  if (error) throw new Error("提示词与图例删除失败，请检查当前账号权限。")
}
