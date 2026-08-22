import { useCallback, useEffect, useMemo, useState } from "react"
import type { PropsWithChildren } from "react"
import type { User } from "@supabase/supabase-js"

import { AuthContext, type ConsoleUser } from "@/features/auth/auth-context"
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase"

const DEMO_SESSION_KEY = "signal-to-story.demo-session"

function toConsoleUser(user: User): ConsoleUser {
  return {
    id: user.id,
    email: user.email,
    displayName:
      typeof user.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name
        : user.email?.split("@")[0] || "Operator",
  }
}

const demoUser: ConsoleUser = {
  id: "demo-operator",
  email: "demo@susesne.cn",
  displayName: "内容主理人",
  isDemo: true,
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<ConsoleUser | null>(() =>
    !isSupabaseConfigured && sessionStorage.getItem(DEMO_SESSION_KEY) === "active"
      ? demoUser
      : null,
  )
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) return

    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ? toConsoleUser(data.session.user) : null)
      setIsLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? toConsoleUser(session.user) : null)
      setIsLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseClient()
    if (!supabase) throw new Error("Supabase 尚未配置，请使用演示入口。")
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signInDemo = useCallback(() => {
    if (isSupabaseConfigured) return
    sessionStorage.setItem(DEMO_SESSION_KEY, "active")
    setUser(demoUser)
  }, [])

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient()
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
    sessionStorage.removeItem(DEMO_SESSION_KEY)
    setUser(null)
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    const supabase = getSupabaseClient()
    if (!supabase) throw new Error("演示模式不发送重置邮件。")
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    })
    if (error) throw error
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const supabase = getSupabaseClient()
    if (!supabase) throw new Error("Supabase 尚未配置。")
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  }, [])

  const value = useMemo(
    () => ({ user, isLoading, isDemoMode: !isSupabaseConfigured, signIn, signInDemo, signOut, resetPassword, updatePassword }),
    [isLoading, resetPassword, signIn, signInDemo, signOut, updatePassword, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
