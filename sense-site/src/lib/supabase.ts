import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export type SupabasePublicConfig = {
  url: string
  key: string
}

type SupabaseEnv = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

function clean(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function decodeBase64Url(segment: string) {
  const normalized = segment.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  return atob(padded)
}

export function decodeJwtRole(key: string) {
  const segment = key.split(".")[1]
  if (!segment) return null
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(segment))
    if (!payload || typeof payload !== "object" || !("role" in payload)) return null
    return typeof payload.role === "string" ? payload.role : null
  } catch {
    return null
  }
}

export function isPrivilegedSupabaseKey(key: string) {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.startsWith("sb_secret")) return true
  if (normalized.includes("service_role") || normalized.includes("service-role")) return true
  return decodeJwtRole(key) === "service_role"
}

export function readSupabasePublicConfig(env: SupabaseEnv = import.meta.env): SupabasePublicConfig | null {
  const url = clean(env.VITE_SUPABASE_URL)
  const key = clean(env.VITE_SUPABASE_ANON_KEY) ?? clean(env.VITE_SUPABASE_PUBLISHABLE_KEY)
  if (!url || !key) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
  } catch {
    return null
  }
  if (isPrivilegedSupabaseKey(key)) {
    console.warn("已忽略浏览器中的 Supabase 高权限密钥。")
    return null
  }
  return { url, key }
}

let client: SupabaseClient | null = null

export function getSupabaseClient() {
  const config = readSupabasePublicConfig()
  if (!config) return null
  client ??= createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}

export function isSupabaseConfigured() {
  return readSupabasePublicConfig() !== null
}
