import { useNavigate } from "react-router"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getNavigationIcon, navigationConfig, type NavigationModule } from "@/config/navigation"
import type { RailStyle } from "@/features/appearance/appearance-context"
import { cn } from "@/lib/utils"

export function AppRail({ activeModule, railStyle }: { activeModule: NavigationModule; railStyle: RailStyle }) {
  const navigate = useNavigate()
  const colored = railStyle === "colored"

  return (
    <aside className={cn("hidden min-h-0 w-16 shrink-0 flex-col border-r md:flex", colored ? "border-primary/10 bg-primary text-primary-foreground" : "border-sidebar-border bg-sidebar text-sidebar-foreground")} aria-label="一级模块" data-rail-style={railStyle}>
      <button type="button" className={cn("flex h-14 shrink-0 items-center justify-center border-b", colored ? "border-white/15" : "border-sidebar-border")} onClick={() => navigate("/dashboard")} aria-label="返回驾驶舱">
        {colored ? <div className="grid size-8 place-items-center rounded-lg bg-background/95 text-primary shadow-sm"><span className="text-xs font-semibold">S²</span></div> : <BrandMark compact />}
      </button>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="flex flex-col gap-1 px-1.5 py-3">
          {navigationConfig.modules.map((module) => {
            const Icon = getNavigationIcon(module.icon)
            const active = module.id === activeModule.id
            return (
              <Tooltip key={module.id}>
                <TooltipTrigger render={<Button variant="ghost" className={cn("h-12 w-full flex-col gap-0.5 rounded-xl border px-0 text-[10px] leading-tight shadow-none", colored ? active ? "border-white/15 bg-background/15 text-primary-foreground hover:bg-background/20 hover:text-primary-foreground" : "border-transparent text-primary-foreground/70 hover:bg-background/10 hover:text-primary-foreground" : active ? "border-primary/15 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "border-transparent text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")} onClick={() => navigate(module.defaultPath)} aria-current={active ? "page" : undefined} />}>
                  <Icon className="size-4" />
                  <span>{module.label}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{module.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </nav>
      </ScrollArea>
    </aside>
  )
}
