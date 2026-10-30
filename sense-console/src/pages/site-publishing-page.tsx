import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { ContentState, Field } from '@/components/content/content-common'
import { useContentAction } from '@/hooks/use-content-action'
import { useContentData } from '@/hooks/use-content-data'
import {
  createSiteCategory,
  createSiteTopic,
  listSiteCategories,
  listSiteEntries,
  listSiteTopics,
  publishSiteEntry,
  publishSiteTopic,
  unpublishSiteEntry,
  unpublishSiteTopic,
  updateSiteCategory,
  type SiteEntry,
} from '@/services/site-publishing-service'

const FORMS = [
  { value: 'article', label: '文章' },
  { value: 'tutorial', label: '教程' },
  { value: 'video', label: '视频' },
  { value: 'comic', label: '漫画' },
  { value: 'resource', label: '资源' },
] as const

const COLUMNS = [
  { value: 'news', label: '动态' },
  { value: 'analysis', label: '分析' },
  { value: 'how_to', label: '方法' },
  { value: 'case', label: '案例' },
] as const

function slugify(raw: string) {
  const ascii = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ascii) && ascii.length <= 120) return ascii
  const fallback = `entry-${Date.now().toString(36)}`
  return fallback
}

export function SitePublishingPage() {
  const content = useContentData()
  const { busy, run } = useContentAction()
  const queryClient = useQueryClient()
  const org = content.workspace?.organization?.id
  const canPublish = Boolean(content.workspace?.canPublish)

  const siteQuery = useQuery({
    queryKey: ['site-publishing', org],
    enabled: Boolean(org),
    queryFn: async () => {
      const [categories, topics, entries] = await Promise.all([
        listSiteCategories(org!),
        listSiteTopics(org!),
        listSiteEntries(org!),
      ])
      return { categories, topics, entries }
    },
  })

  const [catSlug, setCatSlug] = useState('')
  const [catName, setCatName] = useState('')
  const [catDesc, setCatDesc] = useState('')

  const [topicSlug, setTopicSlug] = useState('')
  const [topicTitle, setTopicTitle] = useState('')
  const [topicDesc, setTopicDesc] = useState('')

  const approved = useMemo(
    () => (content.data?.documents ?? []).filter((d) => d.status === 'approved'),
    [content.data?.documents],
  )

  const [documentId, setDocumentId] = useState('')
  const [entryId, setEntryId] = useState('')
  const [slug, setSlug] = useState('')
  const [summary, setSummary] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [form, setForm] = useState<string>('article')
  const [column, setColumn] = useState<string>('analysis')
  const [coverUrl, setCoverUrl] = useState('')
  const [accessLevel, setAccessLevel] = useState<'public' | 'registered'>('public')
  const [featured, setFeatured] = useState(false)

  const selected = approved.find((d) => d.id === documentId)

  if (content.loading || content.error || !content.data || !content.workspace?.organization) {
    return <ContentState {...content} hasOrg={Boolean(content.workspace?.organization)} />
  }
  if (siteQuery.isLoading) return <p className="text-sm text-muted-foreground">正在加载站点发布数据…</p>
  if (siteQuery.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {(siteQuery.error as Error).message}
      </p>
    )
  }

  const categories = siteQuery.data?.categories ?? []
  const topics = siteQuery.data?.topics ?? []
  const entries = siteQuery.data?.entries ?? []
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['site-publishing', org] })
  }

  function statusBadge(entry: SiteEntry) {
    if (entry.status === 'published') return <Badge>已上线</Badge>
    if (entry.status === 'unpublished') return <Badge variant="outline">已下线</Badge>
    return <Badge variant="secondary">草稿</Badge>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="站点发布"
        description="把已批准稿件发布到读者站。上下线走受控事务；不会自动把 intake 写成站点正文。"
      />
      {!canPublish && (
        <p className="text-sm text-muted-foreground">当前为只读视图。站点发布需要 content.publish 权限。</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>站点分类</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canPublish && (
            <form
              className="grid gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  await createSiteCategory(org!, {
                    slug: catSlug || slugify(catName),
                    name: catName,
                    description: catDesc,
                  })
                  setCatSlug('')
                  setCatName('')
                  setCatDesc('')
                  await refresh()
                }, '分类已创建')
              }}
            >
              <Field label="名称">
                <Input required maxLength={80} value={catName} onChange={(e) => setCatName(e.target.value)} />
              </Field>
              <Field label="slug">
                <Input
                  required
                  maxLength={64}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={catSlug}
                  onChange={(e) => setCatSlug(e.target.value)}
                  placeholder="ai-practice"
                />
              </Field>
              <Field label="简介">
                <Input maxLength={1000} value={catDesc} onChange={(e) => setCatDesc(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={busy}>
                  新增分类
                </Button>
              </div>
            </form>
          )}
          <div className="grid gap-2">
            {categories.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <span className="font-medium">{c.name}</span>
                <Badge variant="outline">{c.slug}</Badge>
                {!c.enabled && <Badge variant="secondary">已停用</Badge>}
                {canPublish && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await updateSiteCategory(c, { enabled: !c.enabled })
                        await refresh()
                      }, c.enabled ? '已停用分类' : '已启用分类')
                    }
                  >
                    {c.enabled ? '停用' : '启用'}
                  </Button>
                )}
              </div>
            ))}
            {!categories.length && <p className="text-sm text-muted-foreground">还没有站点分类。</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>从已批准稿件发布</CardTitle>
        </CardHeader>
        <CardContent>
          {canPublish ? (
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!selected) return
                void run(async () => {
                  await publishSiteEntry({
                    entry_id: entryId || undefined,
                    slug: entryId ? undefined : slug || slugify(selected.title),
                    summary,
                    category_id: categoryId,
                    form,
                    content_column: column,
                    cover_url: coverUrl,
                    access_level: accessLevel,
                    featured,
                    document_id: selected.id,
                    revision: selected.revision,
                  })
                  setSummary('')
                  setCoverUrl('')
                  setFeatured(false)
                  await refresh()
                }, '站点条目已发布')
              }}
            >
              <Field label="已批准稿件">
                <NativeSelect
                  required
                  value={documentId}
                  onChange={(e) => {
                    const next = e.target.value
                    setDocumentId(next)
                    const doc = approved.find((d) => d.id === next)
                    if (doc && !slug) setSlug(slugify(doc.title))
                    if (doc && !summary) setSummary(doc.title.slice(0, 200))
                  }}
                >
                  <option value="">请选择</option>
                  {approved.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} · {d.platform} · v{d.revision}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="更新已有条目（可选）">
                <NativeSelect value={entryId} onChange={(e) => setEntryId(e.target.value)}>
                  <option value="">新建条目</option>
                  {entries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title} · {entry.slug}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {!entryId && (
                <Field label="slug">
                  <Input
                    required
                    maxLength={120}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </Field>
              )}
              <Field label="分类">
                <NativeSelect required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">请选择</option>
                  {categories.filter((c) => c.enabled).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="形式">
                <NativeSelect value={form} onChange={(e) => setForm(e.target.value)}>
                  {FORMS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="栏目">
                <NativeSelect value={column} onChange={(e) => setColumn(e.target.value)}>
                  {COLUMNS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="访问级别">
                <NativeSelect
                  value={accessLevel}
                  onChange={(e) => setAccessLevel(e.target.value as 'public' | 'registered')}
                >
                  <option value="public">公开</option>
                  <option value="registered">注册可读</option>
                </NativeSelect>
              </Field>
              <Field label="封面 URL（可选）">
                <Input type="url" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
              </Field>
              <Field label="人工摘要">
                <Textarea
                  required
                  maxLength={1000}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="min-h-24"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
                标为今日精选
              </label>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || !selected || !categoryId || !summary.trim()}>
                  发布到站点
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">需要 content.publish 才能发布。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>站点条目</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!entries.length && <p className="text-sm text-muted-foreground">还没有站点条目。</p>}
          {entries.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{entry.title}</p>
                <p className="text-sm text-muted-foreground">
                  {entry.slug} · {categoryName.get(entry.category_id) ?? '分类'} · {entry.access_level}
                  {entry.featured ? ' · 精选' : ''}
                  {entry.current_version ? ` · v${entry.current_version}` : ''}
                </p>
              </div>
              {statusBadge(entry)}
              {canPublish && entry.status === 'published' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await unpublishSiteEntry(entry.id)
                      await refresh()
                    }, '已下线')
                  }
                >
                  下线
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>专题</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canPublish && (
            <form
              className="grid gap-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  await createSiteTopic(org!, {
                    slug: topicSlug || slugify(topicTitle),
                    title: topicTitle,
                    description: topicDesc,
                  })
                  setTopicSlug('')
                  setTopicTitle('')
                  setTopicDesc('')
                  await refresh()
                }, '专题已创建')
              }}
            >
              <Field label="标题">
                <Input required maxLength={120} value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)} />
              </Field>
              <Field label="slug">
                <Input
                  required
                  maxLength={64}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={topicSlug}
                  onChange={(e) => setTopicSlug(e.target.value)}
                />
              </Field>
              <Field label="简介">
                <Input maxLength={1000} value={topicDesc} onChange={(e) => setTopicDesc(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={busy}>
                  新建专题
                </Button>
              </div>
            </form>
          )}
          {topics.map((topic) => (
            <div key={topic.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
              <span className="font-medium">{topic.title}</span>
              <Badge variant="outline">{topic.slug}</Badge>
              <Badge variant={topic.status === 'published' ? 'default' : 'secondary'}>{topic.status}</Badge>
              {canPublish && topic.status !== 'published' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await publishSiteTopic(topic)
                      await refresh()
                    }, '专题已上线')
                  }
                >
                  上线
                </Button>
              )}
              {canPublish && topic.status === 'published' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await unpublishSiteTopic(topic)
                      await refresh()
                    }, '专题已下线')
                  }
                >
                  下线
                </Button>
              )}
            </div>
          ))}
          {!topics.length && <p className="text-sm text-muted-foreground">还没有专题。</p>}
        </CardContent>
      </Card>
    </div>
  )
}
