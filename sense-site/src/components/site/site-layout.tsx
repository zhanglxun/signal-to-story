import { MenuIcon, MoonIcon, SunIcon, UserIcon } from "lucide-react"
import { useState } from "react"
import { Link, NavLink, Outlet } from "react-router"

import { BrandMark } from "@/components/site/brand-mark"
import { DemoBanner } from "@/components/site/demo-banner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { brandConfig } from "@/config/brand"
import { useReaderAuth } from "@/features/auth/reader-auth"
import { useTheme } from "@/features/theme/theme"
import { cn } from "@/lib/utils"

const primaryNav = [
  { to: "/", label: "首页", end: true },
  { to: "/explore", label: "探索" },
  { to: "/topics", label: "专题" },
  { to: "/resources", label: "资源库" },
] as const

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted hover:text-foreground",
    isActive ? "font-medium text-foreground" : "text-muted-foreground"
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

export function SiteLayout() {
  const { session } = useReaderAuth()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        跳到正文
      </a>
      <DemoBanner />
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" aria-label={`${brandConfig.productName} 首页`} className="shrink-0 rounded-md">
            <BrandMark />
          </Link>
          <nav aria-label="主导航" className="hidden items-center gap-1 md:flex">
            {primaryNav.map((item) => (
              <NavLink key={item.to} to={item.to} end={"end" in item} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            {session ? (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/me" />}>
                <UserIcon />
                <span className="max-w-24 truncate">我的</span>
              </Button>
            ) : (
              <Button size="sm" nativeButton={false} render={<Link to="/login" />}>
                登录
              </Button>
            )}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="打开菜单" />}>
                <MenuIcon />
              </SheetTrigger>
              <SheetContent side="left" className="w-72">
                <SheetHeader>
                  <SheetTitle>
                    <BrandMark />
                  </SheetTitle>
                </SheetHeader>
                <nav aria-label="移动端导航" className="flex flex-col gap-1 px-4">
                  {[...primaryNav, { to: "/me", label: "我的" }].map((item) => (
                    <NavLink key={item.to} to={item.to} end={"end" in item} className={navClass} onClick={() => setOpen(false)}>
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>{brandConfig.productName} · {brandConfig.tagline}</span>
          <span>{brandConfig.copyrightText}</span>
        </div>
      </footer>
    </div>
  )
}
