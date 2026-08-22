import { useState, type FormEvent } from "react"
import { Link, Navigate, useLocation, useNavigate } from "react-router"
import { ArrowRight, FlaskConical } from "lucide-react"
import { toast } from "sonner"

import { AuthShell } from "@/components/auth-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/auth-context"

export function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const { user, signIn, signInDemo, isDemoMode } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const destination = (location.state as { from?: string } | null)?.from || "/dashboard"

  if (user) return <Navigate to={destination} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setPending(true)
    try { await signIn(email, password); navigate(destination, { replace: true }) }
    catch (error) { toast.error(error instanceof Error ? error.message : "登录失败，请重试。") }
    finally { setPending(false) }
  }

  const enterDemo = () => { signInDemo(); navigate(destination, { replace: true }) }

  return <AuthShell>
    <div className="mb-8"><p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-[oklch(.48_.1_177)]">Welcome back</p><h2 className="text-3xl font-semibold tracking-[-.04em]">进入内容控制中心</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">使用已配置的 Supabase 账号密码登录。</p></div>
    {isDemoMode && <Alert className="mb-6 border-amber-400/40 bg-amber-400/8"><FlaskConical /><AlertTitle>当前为本地演示模式</AlertTitle><AlertDescription>尚未写入 Supabase 环境变量。可先进入完整界面预览，演示数据不会上传。</AlertDescription></Alert>}
    <form className="space-y-5" onSubmit={submit}>
      <div className="space-y-2"><Label htmlFor="email">邮箱</Label><Input id="email" type="email" autoComplete="email" placeholder="name@susesne.cn" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={isDemoMode} /></div>
      <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="password">密码</Label><Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">忘记密码？</Link></div><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={isDemoMode} /></div>
      {!isDemoMode && <Button className="w-full" type="submit" disabled={pending}>{pending ? "正在登录…" : "登录"}<ArrowRight /></Button>}
      {isDemoMode && <Button className="w-full" type="button" onClick={enterDemo}>进入演示工作台<ArrowRight /></Button>}
    </form>
  </AuthShell>
}
