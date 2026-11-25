import { Navigate } from "react-router"

import { LoginForm } from "@/components/login-form"
import { useAuth } from "@/features/auth/auth-context"

export function LoginPage() {
  const { user } = useAuth()
  if (user) return <Navigate to="/dashboard" replace />
  return <main className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10"><div className="w-full max-w-sm md:max-w-4xl"><LoginForm /></div></main>
}
