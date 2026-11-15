const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ""
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ""

export const siteEnv = {
  supabaseUrl: url,
  supabasePublishableKey: key,
  siteSlug: import.meta.env.VITE_SITE_SLUG?.trim() || "signal-to-story",
  isSupabaseConfigured: Boolean(url && key),
  /**
   * Demo mode is explicit (VITE_SITE_DEMO=1) or used when no backend is configured.
   * It is never a silent fallback for a failing database: real errors show a retry state.
   */
  // Written with raw env literals so Vite/Rollup can constant-fold it and drop the demo chunk
  // from builds that have a backend configured.
  isDemo:
    import.meta.env.VITE_SITE_DEMO === "1" ||
    import.meta.env.VITE_SITE_DEMO === "true" ||
    !import.meta.env.VITE_SUPABASE_URL ||
    !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
} as const
