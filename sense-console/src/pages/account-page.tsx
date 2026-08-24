import { useState, type FormEvent } from "react"
import { EyeIcon, EyeOffIcon, KeyRoundIcon, UserRoundIcon } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/auth-context"

export function AccountPage() {
  const { user, updateDisplayName, updatePassword } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName ?? "")
  const [profilePending, setProfilePending] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [passwordPending, setPasswordPending] = useState(false)

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfilePending(true)
    try {
      await updateDisplayName(displayName)
      toast.success("个人资料已更新。")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "个人资料保存失败。")
    } finally {
      setProfilePending(false)
    }
  }

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password !== confirmation) {
      toast.error("两次输入的密码不一致。")
      return
    }

    setPasswordPending(true)
    try {
      await updatePassword(password)
      setPassword("")
      setConfirmation("")
      toast.success("密码已更新，下次登录请使用新密码。")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "密码更新失败。")
    } finally {
      setPasswordPending(false)
    }
  }

  const initial = user?.displayName.slice(0, 1).toUpperCase() || "S"

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Personal account"
        title="账号信息"
        description="管理当前登录账号的基础资料和登录密码。密码由 Supabase Auth 安全处理，控制台不会读取或保存明文。"
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><UserRoundIcon className="size-4" /></div>
              <div><CardTitle>个人资料</CardTitle><CardDescription>此处的名称会显示在控制台导航和操作记录中。</CardDescription></div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
              <Avatar className="size-10 rounded-lg"><AvatarFallback className="rounded-lg">{initial}</AvatarFallback></Avatar>
              <div className="min-w-0"><p className="truncate font-medium">{user?.displayName}</p><p className="truncate text-xs text-muted-foreground">{user?.email}</p></div>
            </div>
            <form className="space-y-5" onSubmit={saveProfile} aria-busy={profilePending}>
              <div className="space-y-2"><Label htmlFor="account-email">登录邮箱</Label><Input id="account-email" type="email" value={user?.email ?? ""} disabled /><p className="text-xs leading-5 text-muted-foreground">登录邮箱由系统管理员维护，不能在个人资料页修改。</p></div>
              <div className="space-y-2"><Label htmlFor="display-name">显示名称</Label><Input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={1} maxLength={80} required disabled={profilePending} /></div>
              <Button type="submit" disabled={profilePending || displayName.trim() === user?.displayName}>{profilePending ? "保存中…" : "保存资料"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><KeyRoundIcon className="size-4" /></div>
              <div><CardTitle>登录密码</CardTitle><CardDescription>当前会话验证通过后，可直接设置一个新的登录密码。</CardDescription></div>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={savePassword} aria-busy={passwordPending}>
              <div className="space-y-2"><Label htmlFor="account-new-password">新密码</Label><InputGroup><InputGroupInput id="account-new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={passwordPending} /><InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" onClick={() => setShowPassword((visible) => !visible)} disabled={passwordPending} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOffIcon /> : <EyeIcon />}</InputGroupButton></InputGroupAddon></InputGroup><p className="text-xs leading-5 text-muted-foreground">至少 8 位。建议使用容易记住但难猜测的长密码，并避免与其他网站重复。</p></div>
              <div className="space-y-2"><Label htmlFor="account-confirm-password">确认新密码</Label><Input id="account-confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={passwordPending} /></div>
              <Button type="submit" disabled={passwordPending || password.length < 8}>{passwordPending ? "更新中…" : "更新密码"}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
