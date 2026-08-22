import { Outlet } from "react-router"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { ThemeCustomizer } from "@/components/theme-customizer"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export function AppShell() {
  return <SidebarProvider style={{ "--sidebar-width": "calc(var(--spacing) * 64)", "--header-height": "calc(var(--spacing) * 12)" } as React.CSSProperties}>
    <AppSidebar variant="inset" />
    <SidebarInset><SiteHeader /><main className="flex flex-1 flex-col"><div className="@container/main flex flex-1 flex-col gap-4 p-4 lg:p-6"><Outlet /></div></main></SidebarInset>
    <ThemeCustomizer />
  </SidebarProvider>
}
