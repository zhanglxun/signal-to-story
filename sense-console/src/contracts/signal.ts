export type Signal = {
  id: number
  organizationId: string
  categoryId: number
  name: string
  iconUrl: string | null
  siteUrl: string | null
  summary: string | null
  description: string | null
  isOrganized: boolean
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

export type SignalFilters = {
  organizationId: string
  categoryId?: number
  query?: string
  page?: number
  pageSize?: number
}

export type SignalPage = {
  signals: Signal[]
  totalCount: number
}

export type CreateSignalInput = {
  organizationId: string
  categoryId: number
  name: string
  iconUrl?: string
  siteUrl?: string
  summary?: string
  description?: string
  isOrganized: boolean
}

export type UpdateSignalInput = CreateSignalInput & {
  id: number
}
