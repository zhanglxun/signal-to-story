export const selectionPriorities = [1, 2, 3] as const
export type SelectionPriority = (typeof selectionPriorities)[number]

export const selectionPriorityLabels: Record<SelectionPriority, string> = {
  1: "高",
  2: "中",
  3: "低",
}

export type OutlineTemplateItem = {
  title: string
}

export type Selection = {
  id: number
  organizationId: string
  signalId: number
  name: string
  coreThesis: string | null
  angleType: string | null
  contentFormat: string | null
  negativePrompts: string | null
  outlineTemplate: OutlineTemplateItem[]
  priority: SelectionPriority
  isCompleted: boolean
  description: string | null
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  /** Denormalized from a join with `signals`, for list/detail display. */
  signalName?: string
}

export type SelectionFilters = {
  organizationId: string
  page?: number
  pageSize?: number
}

export type SelectionPage = {
  selections: Selection[]
  totalCount: number
}

export type CreateSelectionInput = {
  organizationId: string
  signalId: number
  name: string
  coreThesis?: string
  angleType?: string
  contentFormat?: string
  negativePrompts?: string
  outlineTemplate: OutlineTemplateItem[]
  priority: SelectionPriority
  isCompleted: boolean
  description?: string
}

export type UpdateSelectionInput = CreateSelectionInput & {
  id: number
}
