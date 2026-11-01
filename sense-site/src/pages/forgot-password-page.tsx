import { useState, type FormEvent } from "react"
import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-context"
import { toAuthMessage } from "@/features/auth/auth-provider"
import { usePageTitle } from "@/lib/use-page-title"
import { AuthPanel, Field } from "@/pages/login-page"

export function ForgotPasswordPage() {
  usePageTitle("重置密码")
  const { mode, requestPasswordReset } = useAuth()
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const result = await requestPasswordReset(email)
      setNotice(
        result === "sent"
          ? "如果这个邮箱可以接收邮件，重置信会发到那里。"
          : "邮件服务还没连接。预览环境不会发送重置信。"
      )
    } catch (caught) {
      setError(toAuthMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthPanel
      title="重置密码"
      description={
        mode === "preview"
          ? "预览环境没有邮箱服务。正式环境会把重置链接发到已注册邮箱。"
          : "填写邮箱后发送重置链接。链接只会打开这个站点的登录页。"
      }
    >
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Field
          id="reset-email"
          label="邮箱"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "正在提交" : "发送重置邮件"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        <Link className="underline underline-offset-4" to="/login">
          返回登录
        </Link>
      </p>
    </AuthPanel>
  )
}
