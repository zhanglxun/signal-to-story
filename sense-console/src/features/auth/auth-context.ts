import { createContext, useContext } from "react"
import type { User } from "@supabase/supabase-js"

export type ConsoleUser = Pick<User, "id" | "email"> & {
  displayName: string
}

export type AuthContextValue = {
  user: ConsoleUser | null
  isLoading: boolean
  isConfigured: boolean
  isRecoverySession: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updateDisplayName: (displayName: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used inside AuthProvider")
  return context
}
