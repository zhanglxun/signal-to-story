import { Link } from "react-router"
import { ShieldX } from "lucide-react"
import { Button } from "@/components/ui/button"
export function ForbiddenPage() { return <main className="grid min-h-svh place-items-center bg-muted p-6"><div className="max-w-md rounded-xl border bg-card p-10 text-center shadow-sm"><ShieldX className="mx-auto mb-5 size-10 text-destructive" /><p className="text-sm font-medium text-muted-foreground">403 · Access denied</p><h1 className="mt-3 text-2xl font-semibold tracking-tight">你没有访问这个空间的权限</h1><p className="mt-3 mb-7 text-sm leading-6 text-muted-foreground">请联系管理员确认账号所属角色与工作空间。</p><Button nativeButton={false} render={<Link to="/dashboard" />}>返回驾驶舱</Button></div></main> }
