import type { SupabaseClient, User } from "@supabase/supabase-js"

import type { ReaderSession } from "@/contracts/site"
import { siteEnv } from "@/lib/env"
import { safeStorage } from "@/lib/format"
import { getSiteSupabase } from "@/lib/supabase"

export interface ReaderAuthService {
  readonly mode: "supabase" | "demo"
  getSession(): Promise<ReaderSession | null>
  onChange(listener: (session: ReaderSession | null) => void): () => void
  signIn(email: string, password: string): Promise<ReaderSession>
  signUp(email: string, password: string, displayName: string): Promise<{ needsConfirmation: boolean }>
  signOut(): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
}

// Same message for unknown account / wrong password / unconfirmed email: no account enumeration.
export const GENERIC_SIGN_IN_ERROR = "邮箱或密码不正确，或邮箱尚未完成验证。"
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials(email: string, password: string) {
  if (!EMAIL_PATTERN.test(email.trim())) throw new Error("请输入有效的邮箱地址。")
  if (password.length < 8) throw new Error("密码至少 8 位。")
}

export function toReaderSession(user: User): ReaderSession {
  const email = user.email ?? ""
  const metaName = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : ""
  return {
    userId: user.id,
    email,
    // Display only — never used for authorization.
    displayName: (metaName || email.split("@")[0] || "读者").slice(0, 80),
    verified: Boolean(user.email_confirmed_at) && !user.is_anonymous,
  }
}

function origin() {
  return typeof window === "undefined" ? "" : window.location.origin
}

export function createSupabaseReaderAuth(client: SupabaseClient | null = getSiteSupabase()): ReaderAuthService {
  if (!client) throw new Error("站点尚未配置数据服务。")
  const auth = client.auth
  return {
    mode: "supabase",
    async getSession() {
      const { data } = await auth.getSession()
      return data.session?.user ? toReaderSession(data.session.user) : null
    },
    onChange(listener) {
      const { data } = auth.onAuthStateChange((_event, session) =>
        listener(session?.user ? toReaderSession(session.user) : null)
      )
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      validateCredentials(email, password)
      const { data, error } = await auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (error || !data.user) {
        if (error?.status === 429) throw new Error("尝试次数过多，请稍后再试。")
        throw new Error(GENERIC_SIGN_IN_ERROR)
      }
      return toReaderSession(data.user)
    },
    async signUp(email, password, displayName) {
      validateCredentials(email, password)
      const { data, error } = await auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: `${origin()}/login?confirmed=1`,
          data: { display_name: displayName.trim().slice(0, 80) },
        },
      })
      if (error) {
        if (error.status === 429) throw new Error("请求过于频繁，请稍后再试。")
        throw new Error("注册未完成，请检查邮箱和密码后重试。")
      }
      return { needsConfirmation: !data.session }
    },
    async signOut() {
      await auth.signOut()
    },
    async requestPasswordReset(email) {
      if (!EMAIL_PATTERN.test(email.trim())) throw new Error("请输入有效的邮箱地址。")
      // Result is intentionally not revealed to the reader.
      await auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${origin()}/update-password` })
    },
    async updatePassword(password) {
      if (password.length < 8) throw new Error("密码至少 8 位。")
      const { error } = await auth.updateUser({ password })
      if (error) throw new Error("密码未更新，请重新打开邮件中的链接后再试。")
    },
  }
}

const DEMO_SESSION_KEY = "sense-site.demo.session"

export function createDemoReaderAuth(): ReaderAuthService {
  const listeners = new Set<(session: ReaderSession | null) => void>()
  let current: ReaderSession | null = null
  try {
    const raw = safeStorage()?.getItem(DEMO_SESSION_KEY)
    current = raw ? (JSON.parse(raw) as ReaderSession) : null
  } catch {
    current = null
  }
  const set = (session: ReaderSession | null) => {
    current = session
    try {
      if (session) safeStorage()?.setItem(DEMO_SESSION_KEY, JSON.stringify(session))
      else safeStorage()?.removeItem(DEMO_SESSION_KEY)
    } catch {
      // Demo convenience only.
    }
    listeners.forEach((listener) => listener(session))
  }
  const demoSession = (email: string, displayName?: string): ReaderSession => ({
    userId: `demo-${email.trim().toLowerCase()}`,
    email: email.trim().toLowerCase(),
    displayName: (displayName?.trim() || email.split("@")[0] || "演示读者").slice(0, 80),
    verified: true,
  })
  return {
    mode: "demo",
    async getSession() {
      return current
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async signIn(email, password) {
      validateCredentials(email, password)
      const session = demoSession(email)
      set(session)
      return session
    },
    async signUp(email, password, displayName) {
      validateCredentials(email, password)
      // Demo mode simulates a confirmed email so the registered-only flow can be walked through.
      set(demoSession(email, displayName))
      return { needsConfirmation: false }
    },
    async signOut() {
      set(null)
    },
    async requestPasswordReset(email) {
      if (!EMAIL_PATTERN.test(email.trim())) throw new Error("请输入有效的邮箱地址。")
    },
    async updatePassword(password) {
      if (password.length < 8) throw new Error("密码至少 8 位。")
    },
  }
}

let instance: ReaderAuthService | null = null
export function getReaderAuth(): ReaderAuthService {
  instance ??= siteEnv.isDemo ? createDemoReaderAuth() : createSupabaseReaderAuth()
  return instance
}
export function setReaderAuthForTests(service: ReaderAuthService | null) {
  instance = service
}
