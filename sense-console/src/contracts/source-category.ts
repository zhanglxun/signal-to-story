export type SourceCategory = {
  id: number
  organizationId: string
  parentId: number | null
  name: string
  iconUrl: string | null
  sortOrder: number
  isActive: boolean
  description: string | null
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export type CreateSourceCategoryInput = {
  organizationId: string
  parentId: number | null
  name: string
  iconUrl?: string
  sortOrder: number
  isActive: boolean
  description?: string
}

export type UpdateSourceCategoryInput = CreateSourceCategoryInput & {
  id: number
}

/** A `SourceCategory` with its direct children attached, for tree rendering. */
export type SourceCategoryNode = SourceCategory & {
  children: SourceCategory[]
}

export function buildSourceCategoryTree(categories: SourceCategory[]): SourceCategoryNode[] {
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const byParent = new Map<number, SourceCategory[]>()
  for (const category of sorted) {
    if (category.parentId === null) continue
    const siblings = byParent.get(category.parentId) ?? []
    siblings.push(category)
    byParent.set(category.parentId, siblings)
  }
  return sorted
    .filter((category) => category.parentId === null)
    .map((category) => ({ ...category, children: byParent.get(category.id) ?? [] }))
}
