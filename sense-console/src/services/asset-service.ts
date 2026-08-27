import type {
  Asset,
  AssetFilters,
  AssetPage,
  CreateAssetInput,
  UpdateAssetInput,
} from "@/contracts/asset"
import { getSupabaseClient } from "@/lib/supabase"

type AssetRow = {
  id: number
  organization_id: string
  asset_type: Asset["assetType"]
  category: string
  media_type: Asset["mediaType"]
  name: string
  cloud_url: string | null
  thumbnail_url: string | null
  is_active: boolean
  description: string | null
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

const assetColumns = "id, organization_id, asset_type, category, media_type, name, cloud_url, thumbnail_url, is_active, description, created_by, created_at, updated_by, updated_at"

function requireSupabase() {
  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 尚未配置。")
  return supabase
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    organizationId: row.organization_id,
    assetType: row.asset_type,
    category: row.category,
    mediaType: row.media_type,
    name: row.name,
    cloudUrl: row.cloud_url,
    thumbnailUrl: row.thumbnail_url,
    isActive: row.is_active,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

const DEFAULT_ASSET_PAGE_SIZE = 12

export async function getAssets(filters: AssetFilters): Promise<AssetPage> {
  const supabase = requireSupabase()
  const pageSize = filters.pageSize ?? DEFAULT_ASSET_PAGE_SIZE
  const page = Math.max(1, filters.page ?? 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let request = supabase
    .from("assets")
    .select(assetColumns, { count: "exact" })
    .eq("organization_id", filters.organizationId)
    .order("updated_at", { ascending: false })
    .range(from, to)

  if (filters.assetType) request = request.eq("asset_type", filters.assetType)
  if (typeof filters.active === "boolean") request = request.eq("is_active", filters.active)

  const normalizedQuery = filters.query?.trim()
  if (normalizedQuery) {
    const pattern = normalizedQuery.replaceAll("%", "\\%").replaceAll("_", "\\_")
    request = request.ilike("search_text", `%${pattern}%`)
  }

  const { data, error, count } = await request
  if (error) throw new Error("暂时无法读取资产列表。")
  return {
    assets: ((data ?? []) as unknown as AssetRow[]).map(mapAsset),
    totalCount: count ?? 0,
  }
}

export async function getAsset(assetId: number): Promise<Asset | null> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from("assets")
    .select(assetColumns)
    .eq("id", assetId)
    .maybeSingle()

  if (error) throw new Error("暂时无法读取资产详情。")
  return data ? mapAsset(data as unknown as AssetRow) : null
}

export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  const supabase = requireSupabase()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("登录会话已失效，请重新登录。")

  const trimOrNull = (value?: string) => value?.trim() || null
  const { data, error } = await supabase
    .from("assets")
    .insert({
      organization_id: input.organizationId,
      asset_type: input.assetType,
      category: input.category.trim() || "general",
      media_type: input.mediaType,
      name: input.name.trim(),
      cloud_url: trimOrNull(input.cloudUrl),
      local_path: trimOrNull(input.localPath),
      thumbnail_url: trimOrNull(input.thumbnailUrl),
      description: trimOrNull(input.description),
      is_active: input.isActive,
      created_by: userData.user.id,
      updated_by: userData.user.id,
    })
    .select(assetColumns)
    .single()

  if (error) throw new Error("资产登记失败，请检查字段和当前账号权限。")
  return mapAsset(data as unknown as AssetRow)
}

export async function updateAsset(input: UpdateAssetInput): Promise<Asset> {
  const supabase = requireSupabase()
  const trimOrNull = (value?: string) => value?.trim() || null
  const values: Record<string, string | boolean | null> = {
    asset_type: input.assetType,
    category: input.category.trim() || "general",
    media_type: input.mediaType,
    name: input.name.trim(),
    cloud_url: trimOrNull(input.cloudUrl),
    thumbnail_url: trimOrNull(input.thumbnailUrl),
    description: trimOrNull(input.description),
    is_active: input.isActive,
  }

  if (input.localPath?.trim()) values.local_path = input.localPath.trim()

  const { data, error } = await supabase
    .from("assets")
    .update(values)
    .eq("id", input.id)
    .eq("organization_id", input.organizationId)
    .select(assetColumns)
    .single()

  if (error) throw new Error("资产更新失败，请检查字段和当前账号权限。")
  return mapAsset(data as unknown as AssetRow)
}
