import { useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/auth-context"
import { toAuthMessage } from "@/features/auth/auth-provider"
import { safeNextPath } from "@/lib/paths"
import { usePageTitle } from "@/lib/use-page-title"

export function LoginPage() {
  usePageTitle("登录")
  const { mode, signIn } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get("next"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signIn(email, password)
      navigate(next, { replace: true })
    } catch (caught) {
      setError(toAuthMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPanel
      title="登录"
      description={
        mode === "preview"
          ? "账号服务还没连接。任意 8 位以上密码都会进入本地预览会话，只保存在这个浏览器里。"
          : "使用读者账号登录。这不会授予控制台权限。"
      }
    >
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Field id="login-email" label="邮箱" type="email" autoComplete="username" value={email} onChange={setEmail} />
        <Field
          id="login-password"
          label="密码"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "正在登录" : "登录"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        <Link className="underline underline-offset-4" to="/forgot-password">
          忘记密码
        </Link>
        <span className="px-2">·</span>
        <Link className="underline underline-offset-4" to={`/register?next=${encodeURIComponent(next)}`}>
          注册
        </Link>
      </p>
    </AuthPanel>
  )
}

export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto grid w-full max-w-md gap-6">
      <header>
        <h1 className="text-3xl font-medium tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
      </header>
      {children}
    </div>
  )
}

export function Field({
  id,
  label,
  type,
  autoComplete,
  value,
  onChange,
}: {
  id: string
  label: string
  type: string
  autoComplete: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
