import { useQuery } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { Link, useSearchParams } from "react-router"

import { ContentGrid } from "@/components/site/content-card"
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/site/page-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  columnLabel,
  contentColumnSchema,
  formLabel,
  listedForms,
  type ContentColumn,
  type ContentForm,
} from "@/contracts/site"
import { parseExploreSearch, toExploreSearchParams, type ExploreSearch } from "@/lib/explore-query"
import { usePageTitle } from "@/lib/use-page-title"
import { useCatalog } from "@/services/catalog"

const columns = contentColumnSchema.options

export function ExplorePage() {
  usePageTitle("探索")
  const catalog = useCatalog()
  const [params, setParams] = useSearchParams()
  const search = parseExploreSearch(params)
  const [draftQuery, setDraftQuery] = useState(search.q ?? "")
  const [seenQuery, setSeenQuery] = useState(search.q ?? "")
  if ((search.q ?? "") !== seenQuery) {
    setSeenQuery(search.q ?? "")
    setDraftQuery(search.q ?? "")
  }

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => catalog.listCategories(),
  })
  const entries = useQuery({
    queryKey: ["entries", search],
    queryFn: () => catalog.listEntries(search),
  })

  function replaceSearch(next: ExploreSearch) {
    setParams(toExploreSearchParams({ ...next, cursor: undefined }))
  }

  const listed = new Set<ContentForm>(listedForms)
  const formOptions: ContentForm[] =
    search.form && !listed.has(search.form) ? [...listedForms, search.form] : [...listedForms]

  return (
    <div className="grid gap-6">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-medium tracking-tight">探索</h1>
        <p className="mt-3 text-muted-foreground">按分类、形式和栏目筛选。搜索只查标题和摘要，条件留在地址里。</p>
      </header>

      <form
        className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault()
          replaceSearch({ ...search, q: draftQuery || undefined })
        }}
      >
        <div className="grid gap-2 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="explore-q">搜索</Label>
          <div className="flex gap-2">
            <Input
              id="explore-q"
              name="q"
              value={draftQuery}
              maxLength={80}
              placeholder="标题或摘要"
              onChange={(event) => setDraftQuery(event.target.value)}
            />
            <Button type="submit">搜索</Button>
          </div>
        </div>
        <FilterSelect
          id="explore-category"
          label="分类"
          value={search.category ?? ""}
          onChange={(category) => replaceSearch({ ...search, category: category || undefined })}
        >
          <NativeSelectOption value="">全部分类</NativeSelectOption>
          {categories.data?.map((category) => (
            <NativeSelectOption key={category.slug} value={category.slug}>
              {category.name}
            </NativeSelectOption>
          ))}
        </FilterSelect>
        <FilterSelect
          id="explore-form"
          label="形式"
          value={search.form ?? ""}
          onChange={(form) => replaceSearch({ ...search, form: form ? (form as ContentForm) : undefined })}
        >
          <NativeSelectOption value="">全部形式</NativeSelectOption>
          {formOptions.map((form) => (
            <NativeSelectOption key={form} value={form}>
              {formLabel[form]}
            </NativeSelectOption>
          ))}
        </FilterSelect>
        <FilterSelect
          id="explore-column"
          label="栏目"
          value={search.column ?? ""}
          onChange={(column) =>
            replaceSearch({
              ...search,
              column: contentColumnSchema.safeParse(column).success ? (column as ContentColumn) : undefined,
            })
          }
        >
          <NativeSelectOption value="">全部栏目</NativeSelectOption>
          {columns.map((column) => (
            <NativeSelectOption key={column} value={column}>
              {columnLabel[column]}
            </NativeSelectOption>
          ))}
        </FilterSelect>
        <div className="flex items-end">
          <Button variant="outline" nativeButton={false} render={<Link to="/explore" />}>
            清空条件
          </Button>
        </div>
      </form>

      {entries.isPending ? <LoadingBlock /> : null}
      {entries.isError ? <ErrorBlock onRetry={() => void entries.refetch()} /> : null}
      {entries.data && entries.data.items.length === 0 ? (
        <EmptyBlock title="没有符合条件的内容" description="换一个分类、形式或关键词。没有发布的分类会停在这里。" />
      ) : null}
      {entries.data && entries.data.items.length > 0 ? (
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">本页 {entries.data.items.length} 篇</p>
          <ContentGrid entries={entries.data.items} />
          <div className="flex flex-wrap gap-2">
            {search.cursor ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to={`/explore?${toExploreSearchParams({ ...search, cursor: undefined })}`} />}
              >
                回到第一页
              </Button>
            ) : null}
            {entries.data.nextCursor ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to={`/explore?${toExploreSearchParams({ ...search, cursor: entries.data.nextCursor })}`} />}
              >
                下一页
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} className="w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </NativeSelect>
    </div>
  )
}
