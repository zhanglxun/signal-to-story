import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useState, type FormEvent, type ReactNode } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useReaderAuth } from "@/features/auth/reader-auth"
import { usePageTitle } from "@/hooks/use-page-title"
import { safeRedirect } from "@/lib/redirect"

function AuthCard({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-sm space-y-6 py-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
      {footer && <div className="text-sm text-muted-foreground">{footer}</div>}
    </div>
  )
}

function PasswordField({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input id={id} type={visible ? "text" : "password"} value={value} minLength={8} required autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} className="pr-9" />
      <Button type="button" variant="ghost" size="icon-sm" className="absolute top-0.5 right-0.5" aria-label={visible ? "隐藏密码" : "显示密码"} onClick={() => setVisible((v) => !v)}>
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  )
}

function useSubmit() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成，请重试。")
    } finally {
      setPending(false)
    }
  }
  return { pending, error, run }
}

export function LoginPage() {
  usePageTitle("登录")
  const { auth, session } = useReaderAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const redirect = safeRedirect(params.get("redirect"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const { pending, error, run } = useSubmit()
  if (session) return <Navigate to={redirect} replace />
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await auth.signIn(email, password)
      navigate(redirect, { replace: true })
    })
  }
  return (
    <AuthCard
      title="读者登录"
      description="登录后可阅读注册专享内容并收藏。读者账号与内容后台账号权限相互独立。"
      footer={<>还没有账号？<Link to={`/register?redirect=${encodeURIComponent(redirect)}`} className="text-foreground underline underline-offset-4">免费注册</Link></>}
    >
      {params.get("confirmed") && <Alert><AlertDescription>邮箱已确认，请登录。</AlertDescription></Alert>}
      <form onSubmit={submit} aria-label="读者登录" className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="login-email">邮箱</Label>
          <Input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">密码</Label>
            <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">忘记密码？</Link>
          </div>
          <PasswordField id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? "正在登录…" : "登录"}</Button>
      </form>
    </AuthCard>
  )
}

export function RegisterPage() {
  usePageTitle("注册")
  const { auth, session } = useReaderAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const redirect = safeRedirect(params.get("redirect"))
  const [displayName, setDisplayName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [sent, setSent] = useState(false)
  const { pending, error, run } = useSubmit()
  if (session) return <Navigate to={redirect} replace />
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const { needsConfirmation } = await auth.signUp(email, password, displayName)
      if (needsConfirmation) setSent(true)
      else navigate(redirect, { replace: true })
    })
  }
  if (sent)
    return (
      <AuthCard title="请查收确认邮件" description="我们已向你的邮箱发送确认链接。完成确认后登录，即可阅读注册专享内容。">
        <Button variant="outline" nativeButton={false} render={<Link to={`/login?redirect=${encodeURIComponent(redirect)}`} />}>前往登录</Button>
      </AuthCard>
    )
  return (
    <AuthCard
      title="免费注册"
      description="注册读者可阅读注册专享内容、收藏与下载资源。注册不会获得任何内容后台权限。"
      footer={<>已有账号？<Link to={`/login?redirect=${encodeURIComponent(redirect)}`} className="text-foreground underline underline-offset-4">登录</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="register-name">昵称（可选）</Label>
          <Input id="register-name" maxLength={80} autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="register-email">邮箱</Label>
          <Input id="register-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="register-password">密码（至少 8 位）</Label>
          <PasswordField id="register-password" value={password} onChange={setPassword} autoComplete="new-password" />
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? "正在提交…" : "注册"}</Button>
      </form>
    </AuthCard>
  )
}

export function ForgotPasswordPage() {
  usePageTitle("找回密码")
  const { auth } = useReaderAuth()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const { pending, error, run } = useSubmit()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await auth.requestPasswordReset(email)
      setSent(true)
    })
  }
  return (
    <AuthCard title="找回密码" description="输入注册邮箱，我们会发送重置密码的链接。" footer={<Link to="/login" className="underline underline-offset-4">返回登录</Link>}>
      {sent ? (
        <Alert><AlertDescription>如果该邮箱已注册，你将收到一封重置邮件。</AlertDescription></Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="forgot-email">邮箱</Label>
            <Input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button type="submit" className="w-full" disabled={pending}>发送重置邮件</Button>
        </form>
      )}
    </AuthCard>
  )
}

export function UpdatePasswordPage() {
  usePageTitle("设置新密码")
  const { auth, session } = useReaderAuth()
  const [password, setPassword] = useState("")
  const [done, setDone] = useState(false)
  const { pending, error, run } = useSubmit()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      await auth.updatePassword(password)
      setDone(true)
    })
  }
  return (
    <AuthCard title="设置新密码" description="请通过重置邮件中的链接打开本页后设置新密码。">
      {done ? (
        <Alert><AlertDescription>密码已更新。</AlertDescription></Alert>
      ) : !session ? (
        <Alert><AlertDescription>链接无效或已过期，请重新申请重置邮件。<Link to="/forgot-password" className="ml-1 underline">重新申请</Link></AlertDescription></Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-password">新密码（至少 8 位）</Label>
            <PasswordField id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
          </div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Button type="submit" className="w-full" disabled={pending}>保存新密码</Button>
        </form>
      )}
    </AuthCard>
  )
}
