import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { OrganizationRole } from "@/contracts/organization"
import { useAuth } from "@/features/auth/auth-context"
import { createOrganizationAccount, getOrganizationAccounts } from "@/services/organization-service"

const organizationAccountsKey = ["organization-accounts"] as const

export function OrganizationAccountsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<OrganizationRole>("")

  const query = useQuery({
    queryKey: organizationAccountsKey,
    queryFn: getOrganizationAccounts,
  })

  const currentAccount = useMemo(
    () => query.data?.accounts.find((account) => account.id === user?.id),
    [query.data?.accounts, user?.id],
  )
  const currentRole = useMemo(
    () => query.data?.roles.find((item) => item.key === currentAccount?.role),
    [currentAccount?.role, query.data?.roles],
  )
  const roleNameByKey = useMemo(
    () => new Map(query.data?.roles.map((item) => [item.key, item.name])),
    [query.data?.roles],
  )
  const grantableRoles = useMemo(
    () => query.data?.roles.filter((item) => item.isAssignable && currentRole?.permissions.includes(item.assignmentPermission)) ?? [],
    [currentRole?.permissions, query.data?.roles],
  )
  const canCreateAccount = Boolean(currentRole?.permissions.includes("account.manage"))

  const mutation = useMutation({
    mutationFn: createOrganizationAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationAccountsKey })
      setDisplayName("")
      setEmail("")
      setPassword("")
      setRole("")
      setOpen(false)
      toast.success("账号已创建，可以使用邮箱和临时密码登录。")
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "账号创建失败。"),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!query.data?.organization) return
    mutation.mutate({
      organizationId: query.data.organization.id,
      displayName,
      email,
      password,
      role,
    })
  }

  if (query.isLoading) return <p className="text-sm text-muted-foreground">正在加载组织与账号…</p>
  if (query.isError) {
    return <Alert variant="destructive"><AlertTitle>无法加载系统管理</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert>
  }
  if (!query.data?.organization) {
    return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成首个 Owner 初始化，再使用后台创建后续账号。</AlertDescription></Alert>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System management"
        title="组织与账号"
        description="管理 Signal to Story 的组织信息、后台登录账号和数据库角色。"
        actions={canCreateAccount ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}><PlusIcon />创建账号</DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={submit} className="contents">
                <DialogHeader>
                  <DialogTitle>创建后台账号</DialogTitle>
                  <DialogDescription>账号创建后邮箱会被直接确认，可立即使用邮箱和临时密码登录。</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2"><Label htmlFor="account-name">显示名称</Label><Input id="account-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} required /></div>
                  <div className="grid gap-2"><Label htmlFor="account-email">邮箱账号</Label><Input id="account-email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
                  <div className="grid gap-2"><Label htmlFor="account-password">临时密码</Label><Input id="account-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">至少 8 位，请通过安全渠道交给账号使用者。</p></div>
                  <div className="grid gap-2"><Label htmlFor="account-role">角色</Label><NativeSelect id="account-role" className="w-full" value={role} onChange={(event) => setRole(event.target.value)} required><NativeSelectOption value="" disabled>请选择角色</NativeSelectOption>{grantableRoles.map((item) => <NativeSelectOption key={item.key} value={item.key}>{item.name}</NativeSelectOption>)}</NativeSelect></div>
                </div>
                <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>取消</Button><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "创建中…" : "创建账号"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : undefined}
      />

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UsersIcon className="size-4" />{query.data.organization.name}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3"><div><p className="text-muted-foreground">组织标识</p><p className="mt-1 font-medium">{query.data.organization.slug}</p></div><div><p className="text-muted-foreground">域名</p><p className="mt-1 font-medium">{query.data.organization.domain ?? "未设置"}</p></div><div><p className="text-muted-foreground">账号数量</p><p className="mt-1 font-medium tabular-nums">{query.data.accounts.length}</p></div></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>后台账号</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>成员</TableHead><TableHead>邮箱账号</TableHead><TableHead>角色</TableHead><TableHead>状态</TableHead><TableHead className="hidden sm:table-cell">创建时间</TableHead></TableRow></TableHeader>
            <TableBody>{query.data.accounts.map((account) => <TableRow key={account.id}><TableCell className="font-medium">{account.displayName}</TableCell><TableCell>{account.email}</TableCell><TableCell><Badge variant="outline">{roleNameByKey.get(account.role) ?? account.role}</Badge></TableCell><TableCell><Badge variant={account.status === "active" ? "default" : "outline"}>{account.status === "active" ? "已启用" : "已停用"}</Badge></TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(account.createdAt))}</TableCell></TableRow>)}</TableBody>
          </Table>
          {query.data.accounts.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">暂无账号。</p>}
        </CardContent>
      </Card>
    </div>
  )
}
