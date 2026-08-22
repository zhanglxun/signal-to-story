import { Navigate, Outlet, useLocation } from "react-router"

import { BrandMark } from "@/components/brand-mark"
import { useAuth } from "@/features/auth/auth-context"

export function RequireAuth() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <main className="grid min-h-svh place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <BrandMark compact />
          <span>正在恢复工作台…</span>
        </div>
      </main>
    )
  }

  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname }} />
}
