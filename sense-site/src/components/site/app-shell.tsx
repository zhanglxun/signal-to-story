import { MenuIcon, MoonIcon, SunIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Link, Outlet, useLocation } from "react-router"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { activeNavId, primaryNav } from "@/config/navigation"
import { useAuth } from "@/features/auth/auth-context"
import { useCatalog } from "@/services/catalog"
import { cn } from "@/lib/utils"

export function AppShell() {
  const catalog = useCatalog()
  const { session } = useAuth()
  const { theme, setTheme } = useTheme()
  const { pathname } = useLocation()
  const currentId = activeNavId(pathname)
  const [menuOpen, setMenuOpen] = useState(false)
  const dark = theme === "dark" || (theme === "system" && document.documentElement.classList.contains("dark"))

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
      >
        跳到主要内容
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="rounded-sm text-sm font-medium tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50">
            Signal to Story
          </Link>
          <nav aria-label="主导航" className="hidden items-center gap-1 md:flex">
            {primaryNav.map((item) => (
              <Link
                key={item.id}
                to={item.to}
                aria-current={currentId === item.id ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50",
                  currentId === item.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline">
                {session.email}
              </span>
            ) : (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/login" />}>
                登录
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={dark ? "切换到浅色" : "切换到深色"}
              onClick={() => setTheme(dark ? "light" : "dark")}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
              aria-expanded={menuOpen}
              aria-controls="site-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <XIcon /> : <MenuIcon />}
            </Button>
          </div>
        </div>
        {menuOpen ? (
          <nav id="site-menu" aria-label="移动导航" className="border-t px-4 py-3 md:hidden">
            <div className="mx-auto grid w-full max-w-5xl gap-1">
              {primaryNav.map((item) => (
                <Link
                  key={item.id}
                  to={item.to}
                  aria-current={currentId === item.id ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={cn(
                    "rounded-md px-3 py-3 text-sm focus-visible:ring-3 focus-visible:ring-ring/50",
                    currentId === item.id ? "bg-muted text-foreground" : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>
        ) : null}
      </header>
      {catalog.source === "stub" ? (
        <div className="border-b bg-muted/70">
          <p className="mx-auto w-full max-w-5xl px-4 py-2 text-sm text-muted-foreground sm:px-6">
            开发占位数据，不是已发布内容。直达链接只验证路由和版面。
          </p>
        </div>
      ) : null}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 outline-none sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t">
        <p className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
          Signal to Story 读者站。正式内容只来自明确发布的站点快照。
        </p>
      </footer>
    </div>
  )
}
