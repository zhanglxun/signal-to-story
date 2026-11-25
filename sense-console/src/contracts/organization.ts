export type OrganizationRole = string

export type OrganizationRoleDefinition = {
  key: OrganizationRole
  name: string
  description: string
  permissions: string[]
  assignmentPermission: string
  isSystem: boolean
  isAssignable: boolean
  sortOrder: number
}

export type OrganizationSummary = {
  id: string
  name: string
  slug: string
  domain: string | null
}

export type OrganizationAccount = {
  id: string
  email: string
  displayName: string
  role: OrganizationRole
  status: "active" | "suspended"
  createdAt: string
}

export type OrganizationRolesResult = {
  organization: OrganizationSummary | null
  roles: OrganizationRoleDefinition[]
}

export type OrganizationAccountsWorkspace = {
  organization: OrganizationSummary | null
  roles: OrganizationRoleDefinition[]
  currentAccount: OrganizationAccount | null
}

export type ListPageParams = {
  page?: number
  pageSize?: number
}

export type OrganizationAccountsPage = {
  accounts: OrganizationAccount[]
  totalCount: number
}

export type CreateOrganizationAccountInput = {
  organizationId: string
  email: string
  password: string
  displayName: string
  role: OrganizationRole
}
