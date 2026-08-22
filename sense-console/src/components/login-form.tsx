import { useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { ArrowRightIcon, FlaskConicalIcon, WorkflowIcon } from "lucide-react"
import { toast } from "sonner"

import { BrandMark } from "@/components/brand-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/features/auth/auth-context"
import { cn } from "@/lib/utils"

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const { signIn, signInDemo, isDemoMode, isDemoAvailable } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const destination = (location.state as { from?: string } | null)?.from || "/dashboard"

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    try { await signIn(email, password); navigate(destination, { replace: true }) }
    catch (error) { toast.error(error instanceof Error ? error.message : "登录失败，请重试。") }
    finally { setPending(false) }
  }

  const enterDemo = () => { signInDemo(); navigate(destination, { replace: true }) }

  return <div className={cn("flex flex-col gap-6", className)} {...props}>
    <Card className="overflow-hidden p-0 shadow-sm"><CardContent className="grid p-0 md:grid-cols-2">
      <form className="p-6 md:p-8" onSubmit={submit}><FieldGroup>
        <div className="mb-2"><BrandMark /></div>
        <div className="flex flex-col gap-2"><h1 className="text-2xl font-bold">欢迎回来</h1><p className="text-balance text-muted-foreground">登录 Signal to Story 内容控制中心</p></div>
        {isDemoMode && <Alert><FlaskConicalIcon /><AlertTitle>本地演示模式</AlertTitle><AlertDescription>Supabase 环境变量尚未配置，演示数据只保存在当前浏览器会话。</AlertDescription></Alert>}
        <Field><FieldLabel htmlFor="email">邮箱</FieldLabel><Input id="email" type="email" placeholder="name@susesne.cn" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isDemoMode} /></Field>
        <Field><div className="flex items-center"><FieldLabel htmlFor="password">密码</FieldLabel><Link to="/forgot-password" className="ml-auto text-sm underline-offset-2 hover:underline">忘记密码？</Link></div><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={isDemoMode} /></Field>
        <Field>{isDemoMode ? <Button type="button" onClick={enterDemo}>进入演示工作台<ArrowRightIcon /></Button> : <Button type="submit" disabled={pending}>{pending ? "登录中…" : "登录"}<ArrowRightIcon /></Button>}</Field>
        {!isDemoMode && isDemoAvailable && <Field>
          <div className="relative text-center text-xs text-muted-foreground before:absolute before:inset-x-0 before:top-1/2 before:border-t"><span className="relative bg-card px-2">本地验收</span></div>
          <Button type="button" variant="outline" onClick={enterDemo}>进入演示工作台<FlaskConicalIcon /></Button>
        </Field>}
        <FieldDescription className="text-center">账号由 Supabase Auth 管理；控制台不会保存密码。</FieldDescription>
      </FieldGroup></form>
      <div className="relative hidden min-h-[560px] bg-muted md:flex md:flex-col md:justify-between md:p-8">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><WorkflowIcon className="size-5" /></div>
        <div><p className="text-sm font-medium text-muted-foreground">Signal to Story</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">从信号发现到故事交付，保持每一步清晰可见。</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">管理选题判断、Agent 执行状态，以及故事、人物、场景、音频和视频资产之间的关系。</p></div>
        <p className="text-xs text-muted-foreground">© susesne.cn</p>
      </div>
    </CardContent></Card>
  </div>
}
