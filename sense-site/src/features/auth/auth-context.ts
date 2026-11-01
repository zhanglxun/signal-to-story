import { createContext, useContext } from "react"

export type ReaderSession = {
  mode: "preview" | "supabase"
  userId: string
  email: string
  emailVerified: boolean
}

export type AuthContextValue = {
  ready: boolean
  session: ReaderSession | null
  mode: "preview" | "supabase"
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<"preview-skipped" | "sent">
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth 需要放在 AuthProvider 里")
  return value
}
