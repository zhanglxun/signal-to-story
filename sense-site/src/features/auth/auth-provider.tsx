import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { z } from "zod"

import { AuthContext, type ReaderSession } from "@/features/auth/auth-context"
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase"

const PREVIEW_SESSION_KEY = "sense-site.preview-session"

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 位").max(200),
})

const previewSchema = z.object({
  email: z.string().trim().min(3).max(200),
})

function readPreviewSession(): ReaderSession | null {
  try {
    const raw = sessionStorage.getItem(PREVIEW_SESSION_KEY)
    if (!raw) return null
    const parsed = previewSchema.safeParse(JSON.parse(raw) as unknown)
    if (!parsed.success) return null
    const email = parsed.data.email.toLowerCase()
    return {
      mode: "preview",
      email,
      userId: `preview:${email}`,
      emailVerified: true,
    }
  } catch {
    return null
  }
}

function writePreviewSession(email: string) {
  sessionStorage.setItem(PREVIEW_SESSION_KEY, JSON.stringify({ email: email.toLowerCase() }))
}

export function toAuthMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "请检查邮箱和密码。"
  const message = error instanceof Error ? error.message : ""
  if (/invalid login credentials/i.test(message)) return "邮箱或密码不正确。"
  if (/already registered/i.test(message)) return "这个邮箱已经注册。"
  if (message && message.length < 180 && !/key|token|secret|service_role/i.test(message)) {
    return message
  }
  return "账号服务没有完成这次请求。"
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const mode: ReaderSession["mode"] = isSupabaseConfigured() ? "supabase" : "preview"
  const [session, setSession] = useState<ReaderSession | null>(() =>
    mode === "preview" ? readPreviewSession() : null
  )
  const [ready, setReady] = useState(mode === "preview")

  useEffect(() => {
    if (mode !== "supabase") return undefined
    const client = getSupabaseClient()
    if (!client) return undefined
    let active = true
    void client.auth.getSession().then(({ data }) => {
      if (!active) return
      const next = data.session
      setSession(
        next
          ? {
              mode: "supabase",
              userId: next.user.id,
              email: next.user.email ?? "",
              emailVerified: Boolean(next.user.email_confirmed_at),
            }
          : null
      )
      setReady(true)
    })
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      setSession(
        next
          ? {
              mode: "supabase",
              userId: next.user.id,
              email: next.user.email ?? "",
              emailVerified: Boolean(next.user.email_confirmed_at),
            }
          : null
      )
      setReady(true)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [mode])

  const clearReaderCache = useCallback(() => {
    queryClient.removeQueries({ queryKey: ["bookmarks"] })
    queryClient.removeQueries({ queryKey: ["bookmark-flag"] })
    queryClient.removeQueries({ queryKey: ["entry-body"] })
  }, [queryClient])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const credentials = credentialsSchema.parse({ email, password })
      if (mode === "preview") {
        writePreviewSession(credentials.email)
        setSession(readPreviewSession())
        return
      }
      const client = getSupabaseClient()
      if (!client) throw new Error("账号服务还没有配置。")
      const { error } = await client.auth.signInWithPassword(credentials)
      if (error) throw new Error(toAuthMessage(error))
    },
    [mode]
  )

  const signUp = useCallback(
    async (email: string, password: string) => {
      const credentials = credentialsSchema.parse({ email, password })
      if (mode === "preview") {
        writePreviewSession(credentials.email)
        setSession(readPreviewSession())
        return
      }
      const client = getSupabaseClient()
      if (!client) throw new Error("账号服务还没有配置。")
      const { error } = await client.auth.signUp({
        email: credentials.email,
        password: credentials.password,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      })
      if (error) throw new Error(toAuthMessage(error))
    },
    [mode]
  )

  const requestPasswordReset = useCallback(
    async (email: string) => {
      const parsed = credentialsSchema.shape.email.parse(email)
      if (mode === "preview") return "preview-skipped" as const
      const client = getSupabaseClient()
      if (!client) throw new Error("账号服务还没有配置。")
      const { error } = await client.auth.resetPasswordForEmail(parsed, {
        redirectTo: `${window.location.origin}/login`,
      })
      if (error) throw new Error(toAuthMessage(error))
      return "sent" as const
    },
    [mode]
  )

  const signOut = useCallback(async () => {
    sessionStorage.removeItem(PREVIEW_SESSION_KEY)
    const client = mode === "supabase" ? getSupabaseClient() : null
    if (client) await client.auth.signOut()
    setSession(null)
    clearReaderCache()
  }, [clearReaderCache, mode])

  const value = useMemo(
    () => ({ ready, session, mode, signIn, signUp, requestPasswordReset, signOut }),
    [ready, session, mode, signIn, signUp, requestPasswordReset, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
