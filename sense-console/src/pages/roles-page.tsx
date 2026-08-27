import { useQuery } from "@tanstack/react-query"

import { PageHeader } from "@/components/page-header"
import { PaginationBar } from "@/components/pagination-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { usePagination } from "@/hooks/use-pagination"
import { getOrganizationRoles } from "@/services/organization-service"

const organizationRolesKey = ["organization-roles"] as const
const PAGE_SIZE = 10

export function RolesPage() {
  const query = useQuery({
    queryKey: organizationRolesKey,
    queryFn: getOrganizationRoles,
  })
  const { page, pageCount, pageItems, setPage, totalCount } = usePagination(query.data?.roles ?? [], PAGE_SIZE)

  if (query.isLoading) return <p className="text-sm text-muted-foreground">正在加载角色列表…</p>
  if (query.isError) {
    return <Alert variant="destructive"><AlertTitle>无法加载角色</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert>
  }
  if (!query.data?.organization) {
    return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织和 Owner 初始化。</AlertDescription></Alert>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System management"
        title="角色管理"
        description={`查看 ${query.data.organization.name} 的角色定义、能力和分配状态。数据由 Supabase 统一维护。`}
      />
      <Card>
        <CardHeader><CardTitle>角色列表</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>角色</TableHead><TableHead>说明</TableHead><TableHead>能力</TableHead><TableHead>类型</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
            <TableBody>{pageItems.map((role) => <TableRow key={role.key}>
              <TableCell><div className="font-medium">{role.name}</div><code className="text-xs text-muted-foreground">{role.key}</code></TableCell>
              <TableCell className="max-w-sm text-muted-foreground">{role.description}</TableCell>
              <TableCell><div className="flex max-w-md flex-wrap gap-1">{role.permissions.map((permission) => <Badge key={permission} variant="secondary">{permission}</Badge>)}</div></TableCell>
              <TableCell><Badge variant="outline">{role.isSystem ? "系统角色" : "自定义角色"}</Badge></TableCell>
              <TableCell><Badge variant={role.isAssignable ? "default" : "outline"}>{role.isAssignable ? "可分配" : "已停用"}</Badge></TableCell>
            </TableRow>)}</TableBody>
          </Table>
          {query.data.roles.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">暂无角色。</p>}
        </CardContent>
      </Card>
      <PaginationBar page={page} pageCount={pageCount} totalCount={totalCount} onPageChange={setPage} />
      <p className="text-sm text-muted-foreground">当前先提供数据库驱动的角色清单；新增、编辑和停用角色将在权限编辑流程确定后开放。</p>
    </div>
  )
}
