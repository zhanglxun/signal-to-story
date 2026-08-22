import { useState, type FormEvent } from "react"
import { Link } from "react-router"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/auth-context"

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(""); const [pending, setPending] = useState(false)
  const { resetPassword, isDemoMode } = useAuth()
  const submit = async (event: FormEvent) => { event.preventDefault(); setPending(true); try { await resetPassword(email); toast.success("重置邮件已发送，请检查邮箱。") } catch (error) { toast.error(error instanceof Error ? error.message : "发送失败") } finally { setPending(false) } }
  return <AuthShell><Link to="/login" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回登录</Link><h2 className="text-2xl font-semibold tracking-tight">找回访问权限</h2><p className="mt-3 mb-8 text-sm leading-6 text-muted-foreground">输入账号邮箱，Supabase Auth 将发送安全的密码重置链接。</p><form onSubmit={submit} className="space-y-5"><div className="space-y-2"><Label htmlFor="reset-email">邮箱</Label><Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div><Button className="w-full" disabled={pending || isDemoMode}>{pending ? "发送中…" : "发送重置邮件"}</Button>{isDemoMode && <p className="text-xs text-muted-foreground">演示模式不会发送邮件，请返回并进入演示工作台。</p>}</form></AuthShell>
}
