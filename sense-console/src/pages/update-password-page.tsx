import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"

import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/auth-context"

export function UpdatePasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [pending, setPending] = useState(false)
  const { isLoading, isRecoverySession, updatePassword } = useAuth()
  const navigate = useNavigate()

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true)
    if (password !== confirmation) {
      toast.error("两次输入的密码不一致。")
      setPending(false)
      return
    }
    try { await updatePassword(password); toast.success("密码已更新"); navigate("/dashboard", { replace: true }) }
    catch (error) { toast.error(error instanceof Error ? error.message : "更新失败") }
    finally { setPending(false) }
  }

  if (isLoading) return <AuthShell><p className="text-sm text-muted-foreground">正在验证密码重置链接…</p></AuthShell>

  if (!isRecoverySession) return <AuthShell><h2 className="text-2xl font-semibold tracking-tight">重置链接无效</h2><p className="mt-3 mb-8 text-sm leading-6 text-muted-foreground">该链接已失效、已使用，或不是从密码恢复邮件打开的。</p><Button className="w-full" nativeButton={false} render={<Link to="/forgot-password" />}>重新发送重置邮件</Button></AuthShell>

  return <AuthShell><h2 className="text-2xl font-semibold tracking-tight">设置新密码</h2><p className="mt-3 mb-8 text-sm leading-6 text-muted-foreground">请使用至少 8 位且未在其他服务重复使用的新密码。</p><form onSubmit={submit} className="space-y-5" aria-busy={pending}><div className="space-y-2"><Label htmlFor="new-password">新密码</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={pending} /></div><div className="space-y-2"><Label htmlFor="confirm-password">确认新密码</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={pending} /></div><Button className="w-full" disabled={pending}>{pending ? "更新中…" : "更新密码"}</Button></form></AuthShell>
}
