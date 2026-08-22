import { MoonIcon, PaletteIcon, SearchIcon, SunIcon } from "lucide-react"
import { useLocation } from "react-router"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useTheme } from "@/components/theme-provider"
import { useAppearance } from "@/features/appearance/appearance-context"

const titles: Record<string, string> = { "/dashboard": "驾驶舱", "/topics": "选题", "/tasks": "任务调度", "/assets": "内容资产", "/settings": "系统设置" }

export function SiteHeader() {
  const { pathname } = useLocation()
  const { theme, setTheme } = useTheme()
  const { setCustomizerOpen } = useAppearance()
  const root = `/${pathname.split("/")[1] || "dashboard"}`

  return <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)"><div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6"><SidebarTrigger className="-ml-1" /><Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" /><span className="text-sm font-medium sm:text-base">{titles[root] || "Signal to Story"}</span><div className="ml-auto flex items-center gap-1"><Button variant="outline" size="sm" className="hidden w-56 justify-start text-muted-foreground md:flex"><SearchIcon /><span>搜索...</span><kbd className="ml-auto text-xs">⌘ K</kbd></Button><Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="切换主题">{theme === "dark" ? <SunIcon /> : <MoonIcon />}</Button><Button variant="ghost" size="icon" onClick={() => setCustomizerOpen(true)} aria-label="外观设置"><PaletteIcon /></Button></div></div></header>
}
