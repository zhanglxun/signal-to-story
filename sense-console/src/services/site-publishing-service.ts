import { getSupabaseClient } from '@/lib/supabase'

function db() {
  const client = getSupabaseClient()
  if (!client) throw new Error('请先配置云端连接。')
  return client
}

function fail(error: { message: string; code?: string } | null) {
  if (!error) return
  if (error.code === '23505') throw new Error('该记录已存在，请刷新后查看。')
  if (error.code === '42501') throw new Error(error.message || '当前账号没有执行此操作的权限。')
  if (error.code === 'P0001' || error.code === '22023') throw new Error(error.message)
  throw new Error(error.message || '云端操作未完成，请检查网络与数据库迁移。')
}

export type SiteCategory = {
  id: string
  site_id: string
  organization_id: string
  slug: string
  name: string
  description: string
  sort_order: number
  enabled: boolean
}

export type SiteTopic = {
  id: string
  site_id: string
  organization_id: string
  slug: string
  title: string
  description: string
  cover_url: string
  status: 'draft' | 'published' | 'unpublished'
  sort_order: number
  published_at: string | null
}

export type SiteEntry = {
  id: string
  site_id: string
  organization_id: string
  slug: string
  title: string
  summary: string
  category_id: string
  form: string
  content_column: string
  cover_url: string
  access_level: 'public' | 'registered' | 'member'
  status: 'draft' | 'published' | 'unpublished'
  featured: boolean
  published_at: string | null
  current_version: number | null
  updated_at: string
}

export type PublishSiteInput = {
  site_id?: string
  entry_id?: string
  slug?: string
  summary: string
  category_id: string
  form: string
  content_column: string
  cover_url?: string
  access_level: 'public' | 'registered'
  featured?: boolean
  document_id: string
  revision: number
  sources?: { title: string; url: string }[]
}

const SITE_ID = 'primary'

export async function ensureSiteSettings(organizationId: string) {
  const { data, error } = await db().rpc('ensure_site_settings', {
    p_organization_id: organizationId,
    p_site_id: SITE_ID,
    p_name: 'Signal to Story',
  })
  fail(error)
  return data
}

export async function listSiteCategories(organizationId: string) {
  await ensureSiteSettings(organizationId)
  const { data, error } = await db()
    .from('site_categories')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('site_id', SITE_ID)
    .order('sort_order')
  fail(error)
  return (data ?? []) as SiteCategory[]
}

export async function createSiteCategory(
  organizationId: string,
  input: { slug: string; name: string; description?: string; sort_order?: number },
) {
  await ensureSiteSettings(organizationId)
  const { data, error } = await db()
    .from('site_categories')
    .insert({
      site_id: SITE_ID,
      organization_id: organizationId,
      slug: input.slug.trim(),
      name: input.name.trim(),
      description: (input.description ?? '').trim(),
      sort_order: input.sort_order ?? 0,
      enabled: true,
    })
    .select()
    .single()
  fail(error)
  return data as SiteCategory
}

export async function updateSiteCategory(
  category: SiteCategory,
  patch: Partial<Pick<SiteCategory, 'name' | 'description' | 'sort_order' | 'enabled'>>,
) {
  const { data, error } = await db()
    .from('site_categories')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', category.id)
    .select()
    .single()
  fail(error)
  return data as SiteCategory
}

export async function listSiteTopics(organizationId: string) {
  await ensureSiteSettings(organizationId)
  const { data, error } = await db()
    .from('site_topics')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('site_id', SITE_ID)
    .order('sort_order')
  fail(error)
  return (data ?? []) as SiteTopic[]
}

export async function createSiteTopic(
  organizationId: string,
  input: { slug: string; title: string; description?: string },
) {
  await ensureSiteSettings(organizationId)
  const { data, error } = await db()
    .from('site_topics')
    .insert({
      site_id: SITE_ID,
      organization_id: organizationId,
      slug: input.slug.trim(),
      title: input.title.trim(),
      description: (input.description ?? '').trim(),
      status: 'draft',
      sort_order: 0,
    })
    .select()
    .single()
  fail(error)
  return data as SiteTopic
}

export async function publishSiteTopic(topic: SiteTopic) {
  const { data, error } = await db()
    .from('site_topics')
    .update({
      status: 'published',
      published_at: topic.published_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', topic.id)
    .select()
    .single()
  fail(error)
  return data as SiteTopic
}

export async function unpublishSiteTopic(topic: SiteTopic) {
  const { data, error } = await db()
    .from('site_topics')
    .update({ status: 'unpublished', updated_at: new Date().toISOString() })
    .eq('id', topic.id)
    .select()
    .single()
  fail(error)
  return data as SiteTopic
}

export async function listSiteEntries(organizationId: string) {
  await ensureSiteSettings(organizationId)
  const { data, error } = await db()
    .from('site_entries')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('site_id', SITE_ID)
    .order('updated_at', { ascending: false })
  fail(error)
  return (data ?? []) as SiteEntry[]
}

export async function publishSiteEntry(input: PublishSiteInput) {
  const { data, error } = await db().rpc('publish_site_entry', {
    p_input: {
      site_id: input.site_id ?? SITE_ID,
      entry_id: input.entry_id ?? null,
      slug: input.slug ?? null,
      summary: input.summary,
      category_id: input.category_id,
      form: input.form,
      content_column: input.content_column,
      cover_url: input.cover_url ?? '',
      access_level: input.access_level,
      featured: Boolean(input.featured),
      document_id: input.document_id,
      revision: input.revision,
      sources: input.sources ?? [],
    },
  })
  fail(error)
  return data as { entry_id: string; slug: string; version: number; status: string; published_at: string }
}

export async function unpublishSiteEntry(entryId: string) {
  const { data, error } = await db().rpc('unpublish_site_entry', { p_entry_id: entryId })
  fail(error)
  return data as { entry_id: string; slug: string; status: string; unpublished_at: string }
}

export type HarvestItem = {
  title: string
  url?: string
  summary?: string
  description?: string
  category_name?: string
}

export async function ingestHarvestedSignals(organizationId: string, items: HarvestItem[]) {
  const { data, error } = await db().rpc('ingest_harvested_signals', {
    p_organization_id: organizationId,
    p_items: items,
  })
  fail(error)
  return data as { created: number; updated: number; skipped: number; items: unknown[] }
}
