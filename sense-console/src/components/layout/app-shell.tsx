import { useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { ClipboardList, LayoutDashboard, Library, LogOut, Menu, Moon, Search, Settings, Sparkles, Sun } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useTheme } from "@/components/theme-provider"
import { useAuth } from "@/features/auth/auth-context"
import { cn } from "@/lib/utils"

const sections = [
  { label: "总览", items: [{ label: "驾驶舱", href: "/dashboard", icon: LayoutDashboard }] },
  { label: "内容生产", items: [
    { label: "选题", href: "/topics", icon: Sparkles },
    { label: "任务", href: "/tasks", icon: ClipboardList },
    { label: "资产", href: "/assets", icon: Library },
  ]},
]

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return <nav className="flex-1 space-y-7 px-3 py-5">{sections.map((section) => (
    <div key={section.label}>
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-sidebar-foreground/40">{section.label}</p>
      <div className="space-y-1">{section.items.map((item) => <NavLink key={item.href} to={item.href} onClick={onNavigate} className={({ isActive }) => cn("group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground/67 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", isActive && "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]")}><item.icon className="size-4" /><span>{item.label}</span></NavLink>)}</div>
    </div>
  ))}</nav>
}

function SideContent({ onNavigate }: { onNavigate?: () => void }) {
  return <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
    <div className="flex h-20 items-center border-b border-sidebar-border px-5"><BrandMark inverse /></div>
    <Navigation onNavigate={onNavigate} />
    <div className="m-3 rounded-xl border border-sidebar-border bg-white/5 p-3">
      <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium">Agent 网络</span><span className="flex items-center gap-1 text-[10px] text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-300" />4 在线</span></div>
      <p className="text-[11px] leading-4 text-sidebar-foreground/50">研究、故事、规划与资产 Agent 已连接。</p>
    </div>
    <p className="px-6 pb-5 text-[10px] text-sidebar-foreground/35">© susesne.cn</p>
  </div>
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

  const signOutNow = async () => { await signOut(); navigate("/login") }
  return <div className="min-h-svh bg-background">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><SideContent /></aside>
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/88 px-4 backdrop-blur-xl sm:px-6">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开导航" />}><Menu /></SheetTrigger>
          <SheetContent side="left" className="w-72 border-0 p-0"><SheetHeader className="sr-only"><SheetTitle>导航</SheetTitle></SheetHeader><SideContent onNavigate={() => setMobileOpen(false)} /></SheetContent>
        </Sheet>
        <div className="lg:hidden"><BrandMark compact /></div>
        <button className="ml-auto hidden h-9 w-full max-w-xs items-center gap-2 rounded-lg border bg-card px-3 text-left text-xs text-muted-foreground shadow-sm sm:flex lg:ml-0" aria-label="搜索"><Search className="size-3.5" /><span>搜索选题、任务或资产</span><kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-[10px]">⌘ K</kbd></button>
        <div className="ml-auto flex items-center gap-2">
          {user?.isDemo && <Badge variant="outline" className="hidden border-amber-400/50 bg-amber-400/10 text-amber-700 sm:inline-flex dark:text-amber-300">演示数据</Badge>}
          <Button variant="ghost" size="icon" aria-label="切换主题" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun /> : <Moon />}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="h-10 gap-2 px-2" />}><Avatar className="size-7"><AvatarFallback className="bg-primary text-xs text-primary-foreground">ST</AvatarFallback></Avatar><span className="hidden text-sm sm:inline">{user?.displayName}</span></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56"><DropdownMenuLabel><div>{user?.displayName}</div><div className="mt-1 font-normal text-muted-foreground">{user?.email}</div></DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem onClick={() => navigate("/settings")}><Settings />系统设置</DropdownMenuItem><DropdownMenuItem onClick={() => void signOutNow()}><LogOut />退出登录</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main key={location.pathname} className="mx-auto w-full max-w-[1480px] animate-in fade-in slide-in-from-bottom-1 px-4 py-6 duration-300 sm:px-6 sm:py-8 xl:px-10"><Outlet /></main>
    </div>
  </div>
}
