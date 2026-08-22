import { useCallback, useEffect, useMemo, useState } from "react"
import type { PropsWithChildren } from "react"
import type { User } from "@supabase/supabase-js"

import { AuthContext, type ConsoleUser } from "@/features/auth/auth-context"
import { getAuthErrorMessage } from "@/features/auth/auth-errors"
import { queryClient } from "@/lib/query-client"
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase"

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

async function resolveConsoleUser(user: User): Promise<ConsoleUser> {
  const fallback = toConsoleUser(user)
  const supabase = getSupabaseClient()
  if (!supabase) return fallback

  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle()

  if (error) {
    console.warn("[auth] 无法读取用户资料，将使用 Auth 显示名。", error)
    return fallback
  }

  return {
    ...fallback,
    displayName: data?.display_name || fallback.displayName,
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<ConsoleUser | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)
  const [isRecoverySession, setIsRecoverySession] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) return

    let active = true

    void supabase.auth.getUser().then(async ({ data, error }) => {
      if (!active) return
      if (error && error.name !== "AuthSessionMissingError") {
        console.warn("[auth] 无法验证已保存的 Supabase 会话。", error)
      }
      const consoleUser = data.user ? await resolveConsoleUser(data.user) : null
      if (!active) return
      setUser(consoleUser)
      setIsLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event === "INITIAL_SESSION") return
      if (event === "PASSWORD_RECOVERY") setIsRecoverySession(true)
      if (event === "SIGNED_OUT") {
        setIsRecoverySession(false)
        queryClient.clear()
      }
      setUser((currentUser) => {
        if (!session?.user) return null
        const fallback = toConsoleUser(session.user)
        return currentUser?.id === fallback.id
          ? { ...fallback, displayName: currentUser.displayName }
          : fallback
      })
      if (session?.user) {
        void resolveConsoleUser(session.user).then((resolvedUser) => {
          if (!active) return
          setUser((currentUser) => currentUser?.id === resolvedUser.id ? resolvedUser : currentUser)
        })
      }
      setIsLoading(false)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseClient()
    if (!supabase) throw new Error("Supabase 尚未配置。")
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(getAuthErrorMessage(error, "登录失败，请稍后再试。"))
    if (!data.user) throw new Error("登录失败，请稍后再试。")
    setIsRecoverySession(false)
    setUser(await resolveConsoleUser(data.user))
  }, [])

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient()
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: "local" })
      if (error) throw new Error(getAuthErrorMessage(error, "退出登录失败，请稍后再试。"))
    }
    queryClient.clear()
    setIsRecoverySession(false)
    setUser(null)
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    const supabase = getSupabaseClient()
    if (!supabase) throw new Error("Supabase 尚未配置。")
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
    () => ({ user, isLoading, isConfigured: isSupabaseConfigured, isRecoverySession, signIn, signOut, resetPassword, updatePassword }),
    [isLoading, isRecoverySession, resetPassword, signIn, signOut, updatePassword, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
