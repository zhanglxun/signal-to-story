import { Building2Icon, LibraryIcon, ListTodoIcon, LayoutDashboardIcon, Settings2Icon, ShieldCheckIcon, SparklesIcon, SquarePenIcon } from "lucide-react"
import { NavLink, useLocation, useNavigate } from "react-router"

import { BrandMark } from "@/components/brand-mark"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { useAppearance } from "@/features/appearance/appearance-context"

const primaryNav = [{ title: "驾驶舱", url: "/dashboard", icon: LayoutDashboardIcon }]
const productionNav = [
  { title: "选题", url: "/topics", icon: SparklesIcon },
  { title: "任务", url: "/tasks", icon: ListTodoIcon },
  { title: "资产", url: "/assets", icon: LibraryIcon },
]
const systemNav = [
  { title: "组织与账号", url: "/system/accounts", icon: Building2Icon },
  { title: "角色管理", url: "/system/roles", icon: ShieldCheckIcon },
]

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation()
  const navigate = useNavigate()
  const { setCustomizerOpen } = useAppearance()

  const renderItems = (items: typeof primaryNav) => <SidebarMenu>{items.map((item) => {
    const active = location.pathname === item.url || location.pathname.startsWith(`${item.url}/`)
    return <SidebarMenuItem key={item.url}><SidebarMenuButton tooltip={item.title} isActive={active} render={<NavLink to={item.url} />}><item.icon /><span>{item.title}</span></SidebarMenuButton></SidebarMenuItem>
  })}</SidebarMenu>

  return <Sidebar collapsible="icon" {...props}>
    <SidebarHeader><SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" render={<NavLink to="/dashboard" />} className="data-[slot=sidebar-menu-button]:p-1.5!"><BrandMark /><span className="sr-only">Signal to Story</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarHeader>
    <SidebarContent>
      <SidebarGroup><SidebarGroupContent className="flex flex-col gap-2"><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="新建选题" className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground" onClick={() => navigate("/topics")}><SquarePenIcon /><span>新建选题</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>{renderItems(primaryNav)}</SidebarGroupContent></SidebarGroup>
      <SidebarSeparator />
      <SidebarGroup><SidebarGroupLabel>内容生产</SidebarGroupLabel><SidebarGroupContent>{renderItems(productionNav)}</SidebarGroupContent></SidebarGroup>
      <SidebarGroup><SidebarGroupLabel>系统管理</SidebarGroupLabel><SidebarGroupContent>{renderItems(systemNav)}</SidebarGroupContent></SidebarGroup>
      <SidebarGroup className="mt-auto"><SidebarGroupContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="外观设置" onClick={() => setCustomizerOpen(true)}><Settings2Icon /><span>外观设置</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarGroupContent></SidebarGroup>
    </SidebarContent>
    <SidebarFooter><NavUser /></SidebarFooter>
  </Sidebar>
}
