import { MenuIcon, MoonIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SearchIcon, SettingsIcon, SunIcon } from "lucide-react"

import { NavUser } from "@/components/nav-user"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { useAppearance } from "@/features/appearance/appearance-context"

export function AppHeader({ siderCollapsed, onToggleSider, onOpenMobileNavigation }: { siderCollapsed: boolean; onToggleSider: () => void; onOpenMobileNavigation: () => void }) {
  const { theme, setTheme } = useTheme()
  const { setCustomizerOpen } = useAppearance()

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-4">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenMobileNavigation} aria-label="打开菜单"><MenuIcon /></Button>
      <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={onToggleSider} aria-label={siderCollapsed ? "展开菜单" : "收起菜单"}>{siderCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}</Button>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="outline" size="sm" className="hidden w-56 justify-start text-muted-foreground lg:flex"><SearchIcon /><span>搜索...</span><kbd className="ml-auto text-xs">⌘ K</kbd></Button>
        <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="切换主题">{theme === "dark" ? <SunIcon /> : <MoonIcon />}</Button>
        <Button variant="ghost" size="icon" onClick={() => setCustomizerOpen(true)} aria-label="外观设置"><SettingsIcon /></Button>
        <NavUser />
      </div>
    </header>
  )
}
