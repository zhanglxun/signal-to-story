import { useState, type FormEvent } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-context"
import { toAuthMessage } from "@/features/auth/auth-provider"
import { safeNextPath } from "@/lib/paths"
import { usePageTitle } from "@/lib/use-page-title"
import { AuthPanel, Field } from "@/pages/login-page"

export function RegisterPage() {
  usePageTitle("注册")
  const { mode, signUp } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get("next"))
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setError("两次密码不一致。")
      return
    }
    setPending(true)
    setError(null)
    try {
      await signUp(email, password)
      navigate(next, { replace: true })
    } catch (caught) {
      setError(toAuthMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPanel
      title="注册"
      description={
        mode === "preview"
          ? "预览注册只写进这个浏览器，不会发确认信，也不会加入控制台组织。"
          : "注册后需要完成邮箱验证。读者账号不能打开后台数据。"
      }
    >
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Field id="register-email" label="邮箱" type="email" autoComplete="username" value={email} onChange={setEmail} />
        <Field
          id="register-password"
          label="密码"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        <Field
          id="register-confirm"
          label="再输入一次密码"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "正在注册" : "注册"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        已有账号？
        <Link className="ml-2 underline underline-offset-4" to={`/login?next=${encodeURIComponent(next)}`}>
          登录
        </Link>
      </p>
    </AuthPanel>
  )
}
