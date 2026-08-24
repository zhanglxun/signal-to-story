import { NavLink } from "react-router"

import { BrandMark } from "@/components/brand-mark"
import { buttonVariants } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { getNavigationIcon, navigationConfig, type NavigationItem, type NavigationModule } from "@/config/navigation"
import { cn } from "@/lib/utils"

export function MobileNavigation({ open, onOpenChange, activeModule, activeItem }: { open: boolean; onOpenChange: (open: boolean) => void; activeModule: NavigationModule; activeItem?: NavigationItem }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[300px] gap-0 p-0 md:hidden">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle><BrandMark /></SheetTitle>
          <SheetDescription className="sr-only">Signal to Story 页面导航</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <nav className="space-y-5 p-4">
            {navigationConfig.modules.map((module) => (
              <section key={module.id}>
                <p className={cn("mb-2 px-2 text-xs font-medium", module.id === activeModule.id ? "text-primary" : "text-muted-foreground")}>{module.label}</p>
                <div className="space-y-4">
                  {module.groups.map((group) => (
                    <div key={group.id}>
                      <p className="mb-1 px-3 text-[11px] text-muted-foreground">{group.label}</p>
                      <div className="space-y-1">
                        {group.items.map((item) => {
                          const Icon = getNavigationIcon(item.icon)
                          const active = item.id === activeItem?.id
                          return (
                            <NavLink key={item.id} to={item.path} onClick={() => onOpenChange(false)} aria-current={active ? "page" : undefined} className={cn(buttonVariants({ variant: "ghost" }), "h-9 w-full justify-start gap-2 px-3 font-normal", active ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : "text-muted-foreground hover:text-foreground")}>
                              <Icon className="size-4" />
                              {item.label}
                            </NavLink>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
