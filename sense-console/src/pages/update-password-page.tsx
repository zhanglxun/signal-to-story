import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router"
import { toast } from "sonner"
import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/features/auth/auth-context"

export function UpdatePasswordPage() {
  const [password, setPassword] = useState(""); const [pending, setPending] = useState(false); const { updatePassword } = useAuth(); const navigate = useNavigate()
  const submit = async (event: FormEvent) => { event.preventDefault(); setPending(true); try { await updatePassword(password); toast.success("密码已更新"); navigate("/dashboard", { replace: true }) } catch (error) { toast.error(error instanceof Error ? error.message : "更新失败") } finally { setPending(false) } }
  return <AuthShell><h2 className="text-3xl font-semibold tracking-[-.04em]">设置新密码</h2><p className="mt-3 mb-8 text-sm leading-6 text-muted-foreground">请使用至少 8 位的新密码。</p><form onSubmit={submit} className="space-y-5"><div className="space-y-2"><Label htmlFor="new-password">新密码</Label><Input id="new-password" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></div><Button className="w-full" disabled={pending}>{pending ? "更新中…" : "更新密码"}</Button></form></AuthShell>
}
