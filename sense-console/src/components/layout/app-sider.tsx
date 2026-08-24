import { NavLink } from "react-router"

import { buttonVariants } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getNavigationIcon, type NavigationItem, type NavigationModule } from "@/config/navigation"
import { cn } from "@/lib/utils"

export function AppSider({ activeModule, activeItem, collapsed }: { activeModule: NavigationModule; activeItem?: NavigationItem; collapsed: boolean }) {
  return (
    <div className={cn("hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out md:block", collapsed ? "w-0" : "w-[180px]")}>
      <aside className={cn("flex h-full w-[180px] flex-col border-r bg-card transition-[transform,opacity] duration-300 ease-in-out", collapsed && "-translate-x-full opacity-0")} aria-label={`${activeModule.label}菜单`} aria-hidden={collapsed}>
        <div className="flex h-14 shrink-0 items-center border-b px-4">
          <span className="truncate text-sm font-semibold">{activeModule.label}</span>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <nav className="space-y-5 p-3">
            {activeModule.groups.map((group) => {
              const GroupIcon = getNavigationIcon(group.icon)
              return (
                <section key={group.id}>
                  <div className="mb-1.5 flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground"><GroupIcon className="size-3.5" /><span className="truncate">{group.label}</span></div>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const Icon = getNavigationIcon(item.icon)
                      const active = item.id === activeItem?.id
                      return (
                        <NavLink key={item.id} to={item.path} aria-current={active ? "page" : undefined} className={cn(buttonVariants({ variant: "ghost" }), "h-9 w-full justify-start gap-2 px-3 font-normal", active ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground hover:text-foreground")}>
                          <Icon className="size-4" />
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </nav>
        </ScrollArea>
      </aside>
    </div>
  )
}
