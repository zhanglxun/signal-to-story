import { ChevronDownIcon, LogOutIcon, SettingsIcon, UserRoundIcon } from "lucide-react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/features/auth/auth-context"

export function NavUser() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const initial = user?.displayName.slice(0, 1).toUpperCase() || "S"
  const logout = async () => {
    try {
      await signOut()
      navigate("/login", { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "退出登录失败，请稍后再试。")
    }
  }

  return <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" className="ml-1 h-9 gap-2 px-1.5 sm:px-2" />}><Avatar className="size-7 rounded-lg"><AvatarFallback className="rounded-lg text-xs">{initial}</AvatarFallback></Avatar><div className="hidden max-w-32 text-left text-sm leading-tight lg:grid"><span className="truncate font-medium">{user?.displayName}</span><span className="truncate text-xs text-muted-foreground">{user?.email}</span></div><ChevronDownIcon className="hidden size-3.5 text-muted-foreground sm:block" /></DropdownMenuTrigger><DropdownMenuContent className="min-w-56" side="bottom" align="end" sideOffset={6}><DropdownMenuGroup><DropdownMenuLabel className="font-normal"><div className="flex items-center gap-2"><Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg">{initial}</AvatarFallback></Avatar><div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">{user?.displayName}</span><span className="truncate text-xs text-muted-foreground">{user?.email}</span></div></div></DropdownMenuLabel></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem onClick={() => navigate("/account")}><UserRoundIcon />账号信息</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/settings")}><SettingsIcon />系统设置</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => void logout()}><LogOutIcon />退出登录</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
}
