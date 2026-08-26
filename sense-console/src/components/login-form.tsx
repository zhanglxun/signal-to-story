import { useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { ArrowRightIcon, EyeIcon, EyeOffIcon, WorkflowIcon } from "lucide-react"
import { toast } from "sonner"

import { BrandMark } from "@/components/brand-mark"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { useAuth } from "@/features/auth/auth-context"
import { cn } from "@/lib/utils"

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const { signIn, isConfigured } = useAuth()
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

  return <div className={cn("flex flex-col gap-6", className)} {...props}>
    <Card className="overflow-hidden p-0 shadow-sm"><CardContent className="grid p-0 md:grid-cols-2">
       <div className="relative hidden min-h-[560px] bg-muted md:flex md:flex-col md:justify-between md:p-8">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><WorkflowIcon className="size-5" /></div>
        <div><p className="text-sm font-medium text-muted-foreground">Signal to Story</p><h2 className="mt-3 text-2xl font-semibold tracking-tight">从信号发现到故事交付，保持每一步清晰可见。</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">管理选题判断、Agent 执行状态，以及故事、人物、场景、音频和视频资产之间的关系。</p></div>
        <p className="text-xs text-muted-foreground">© susesne.cn</p>
      </div>
      <form className="p-6 md:p-8" onSubmit={submit} aria-busy={pending}><FieldGroup>
        <div className="mb-2">
          <BrandMark />
        </div>
        <div className="flex flex-col gap-2"><h1 className="text-2xl font-bold">欢迎回来</h1><p className="text-balance text-muted-foreground">登录 Signal to Story 内容控制中心</p></div>
        {!isConfigured && <Alert><AlertTitle>认证尚未配置</AlertTitle><AlertDescription>请先在 .env.local 配置 Supabase 项目地址和 Publishable Key。</AlertDescription></Alert>}
        <Field><FieldLabel htmlFor="email">邮箱</FieldLabel><Input id="email" type="email" placeholder="name@susesne.cn" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={!isConfigured || pending} /></Field>
        <Field><div className="flex items-center"><FieldLabel htmlFor="password">密码</FieldLabel><Link to="/forgot-password" className="ml-auto text-sm underline-offset-2 hover:underline">忘记密码？</Link></div><InputGroup><InputGroupInput id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={!isConfigured || pending} /><InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" onClick={() => setShowPassword((visible) => !visible)} disabled={!isConfigured || pending} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOffIcon /> : <EyeIcon />}</InputGroupButton></InputGroupAddon></InputGroup></Field>
        <Field><Button type="submit" disabled={!isConfigured || pending}>{pending ? "登录中…" : "登录"}<ArrowRightIcon /></Button></Field>
        <FieldDescription className="text-center">账号由 Supabase Auth 管理；控制台不会保存密码。</FieldDescription>
       </FieldGroup>
      </form>
    </CardContent>
    </Card>
  </div>
}
