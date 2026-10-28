import {
  contentColumnSchema,
  contentFormSchema,
  type ContentColumn,
  type ContentForm,
} from "@/contracts/site"

export type ExploreSearch = {
  category?: string
  form?: ContentForm
  column?: ContentColumn
  q?: string
  cursor?: string
}

function bound(value: string | null, max: number) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

export function parseExploreSearch(params: URLSearchParams): ExploreSearch {
  const form = contentFormSchema.safeParse(params.get("form") ?? undefined)
  const column = contentColumnSchema.safeParse(params.get("column") ?? undefined)
  return {
    category: bound(params.get("category"), 80),
    form: form.success ? form.data : undefined,
    column: column.success ? column.data : undefined,
    q: bound(params.get("q"), 80),
    cursor: bound(params.get("cursor"), 200),
  }
}

export function toExploreSearchParams(search: ExploreSearch) {
  const params = new URLSearchParams()
  if (search.category) params.set("category", search.category)
  if (search.form) params.set("form", search.form)
  if (search.column) params.set("column", search.column)
  if (search.q) params.set("q", search.q)
  if (search.cursor) params.set("cursor", search.cursor)
  return params
}

export function exploreHref(search: ExploreSearch) {
  const params = toExploreSearchParams(search)
  const query = params.toString()
  return query ? `/explore?${query}` : "/explore"
}
