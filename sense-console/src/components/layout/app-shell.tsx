import { useState } from "react"
import { Outlet, useLocation } from "react-router"

import { AppHeader } from "@/components/layout/app-header"
import { AppRail } from "@/components/layout/app-rail"
import { AppSider } from "@/components/layout/app-sider"
import { MobileNavigation } from "@/components/layout/mobile-navigation"
import { ThemeCustomizer } from "@/components/theme-customizer"
import { resolveNavigation } from "@/config/navigation"
import { useAppearance } from "@/features/appearance/appearance-context"

export function AppShell() {
  const { pathname } = useLocation()
  const { railStyle } = useAppearance()
  const { activeModule, activeItem } = resolveNavigation(pathname)
  const [siderCollapsed, setSiderCollapsed] = useState(false)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)

  return (
    <div className="flex h-svh overflow-hidden bg-muted/20 text-foreground">
      <AppRail activeModule={activeModule} railStyle={railStyle} />
      <AppSider activeModule={activeModule} activeItem={activeItem} collapsed={siderCollapsed} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader siderCollapsed={siderCollapsed} onToggleSider={() => setSiderCollapsed((collapsed) => !collapsed)} onOpenMobileNavigation={() => setMobileNavigationOpen(true)} />
        <main className="min-h-0 flex-1 overflow-auto">
          <div className="@container/main flex min-h-full flex-col gap-4 p-4 lg:p-6">{activeModule.id === "video-production" && <p role="note" className="rounded-lg border bg-muted p-3 text-sm text-muted-foreground">视频模块保留现有演示页面，尚未接入云端生产。请从内容项目导出脚本与素材交接包，视频执行将单独建设。</p>}<Outlet /></div>
        </main>
      </div>
      <MobileNavigation open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen} activeModule={activeModule} activeItem={activeItem} />
      <ThemeCustomizer />
    </div>
  )
}
