import { useCallback, useEffect, useMemo, useState } from "react"
import type { PropsWithChildren } from "react"
import type { User } from "@supabase/supabase-js"

import { AuthContext, type ConsoleUser } from "@/features/auth/auth-context"
import { getAuthErrorMessage } from "@/features/auth/auth-errors"
import { queryClient } from "@/lib/query-client"
import { getSupabaseClient, isDemoModeEnabled, isSupabaseConfigured } from "@/lib/supabase"

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
  const isDemoAvailable = isDemoModeEnabled()
  const [user, setUser] = useState<ConsoleUser | null>(() =>
    isDemoModeEnabled() && sessionStorage.getItem(DEMO_SESSION_KEY) === "active"
      ? demoUser
      : null,
  )
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [isRecoverySession, setIsRecoverySession] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) return

    let active = true

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return
      if (error && error.name !== "AuthSessionMissingError") {
        console.warn("[auth] 无法验证已保存的 Supabase 会话。", error)
      }
      setUser((currentUser) =>
        data.user
          ? toConsoleUser(data.user)
          : currentUser?.isDemo
            ? currentUser
            : null,
      )
      setIsLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event === "INITIAL_SESSION") return
      if (event === "PASSWORD_RECOVERY") setIsRecoverySession(true)
      if (event === "SIGNED_OUT") {
        setIsRecoverySession(false)
        sessionStorage.removeItem(DEMO_SESSION_KEY)
        queryClient.clear()
      }
      setUser((currentUser) =>
        session?.user ? toConsoleUser(session.user) : currentUser?.isDemo ? currentUser : null,
      )
      setIsLoading(false)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseClient()
    if (!supabase) throw new Error("Supabase 尚未配置，请使用演示入口。")
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(getAuthErrorMessage(error, "登录失败，请稍后再试。"))
    if (!data.user) throw new Error("登录失败，请稍后再试。")
    sessionStorage.removeItem(DEMO_SESSION_KEY)
    setIsRecoverySession(false)
    setUser(toConsoleUser(data.user))
  }, [])

  const signInDemo = useCallback(() => {
    if (!isDemoModeEnabled()) return
    sessionStorage.setItem(DEMO_SESSION_KEY, "active")
    setIsLoading(false)
    setIsRecoverySession(false)
    setUser(demoUser)
  }, [])

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient()
    if (supabase && !user?.isDemo) {
      const { error } = await supabase.auth.signOut({ scope: "local" })
      if (error) throw new Error(getAuthErrorMessage(error, "退出登录失败，请稍后再试。"))
    }
    sessionStorage.removeItem(DEMO_SESSION_KEY)
    queryClient.clear()
    setIsRecoverySession(false)
    setUser(null)
  }, [user?.isDemo])

  const resetPassword = useCallback(async (email: string) => {
    const supabase = getSupabaseClient()
    if (!supabase) throw new Error("演示模式不发送重置邮件。")
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/update-password`,
    })
    if (error) throw new Error(getAuthErrorMessage(error, "暂时无法发送重置邮件，请稍后再试。"))
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const supabase = getSupabaseClient()
    if (!supabase) throw new Error("Supabase 尚未配置。")
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw new Error(getAuthErrorMessage(error, "密码更新失败，请重新打开重置链接。"))
    setIsRecoverySession(false)
  }, [])

  const value = useMemo(
    () => ({ user, isLoading, isDemoMode: !isSupabaseConfigured, isDemoAvailable, isRecoverySession, signIn, signInDemo, signOut, resetPassword, updatePassword }),
    [isDemoAvailable, isLoading, isRecoverySession, resetPassword, signIn, signInDemo, signOut, updatePassword, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
