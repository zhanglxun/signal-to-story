import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router"

import { useAuth } from "@/features/auth/auth-context"
import { LoadingBlock } from "@/components/site/page-state"

export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, session } = useAuth()
  const location = useLocation()
  if (!ready) return <LoadingBlock label="正在确认登录状态" />
  if (!session) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return children
}
