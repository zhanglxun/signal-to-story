import { EllipsisVerticalIcon, LogOutIcon, SettingsIcon, UserRoundIcon } from "lucide-react"
import { useNavigate } from "react-router"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { useAuth } from "@/features/auth/auth-context"

export function NavUser() {
  const { isMobile } = useSidebar()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const initial = user?.displayName.slice(0, 1).toUpperCase() || "S"
  const logout = async () => { await signOut(); navigate("/login") }

  return <SidebarMenu><SidebarMenuItem><DropdownMenu><DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground" />}><Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg">{initial}</AvatarFallback></Avatar><div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">{user?.displayName}</span><span className="truncate text-xs text-muted-foreground">{user?.email}</span></div><EllipsisVerticalIcon className="ml-auto size-4" /></DropdownMenuTrigger><DropdownMenuContent className="min-w-56" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}><DropdownMenuGroup><DropdownMenuLabel className="font-normal"><div className="flex items-center gap-2"><Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg">{initial}</AvatarFallback></Avatar><div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">{user?.displayName}</span><span className="truncate text-xs text-muted-foreground">{user?.email}</span></div></div></DropdownMenuLabel></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem onClick={() => navigate("/settings")}><UserRoundIcon />账号信息</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/settings")}><SettingsIcon />系统设置</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuItem onClick={() => void logout()}><LogOutIcon />退出登录</DropdownMenuItem></DropdownMenuContent></DropdownMenu></SidebarMenuItem></SidebarMenu>
}
