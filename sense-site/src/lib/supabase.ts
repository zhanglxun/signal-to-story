import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { siteEnv } from "@/lib/env"

let client: SupabaseClient | null = null

/** Reader-site client: Project URL + publishable key only. Separate storage key from the console. */
export function getSiteSupabase() {
  if (!siteEnv.isSupabaseConfigured) return null
  client ??= createClient(siteEnv.supabaseUrl, siteEnv.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "sense-site.auth",
    },
  })
  return client
}
