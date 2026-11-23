const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ""
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ""

export const siteEnv = {
  supabaseUrl: url,
  supabasePublishableKey: key,
  siteName: import.meta.env.VITE_SITE_NAME?.trim() || "星火工厂 · Signal to Story",
  siteDescription:
    import.meta.env.VITE_SITE_DESCRIPTION?.trim() || "企业 AI 实战、AI 知识科普、工具与工作流、故事与创意。",
  /** Optional: only show documents of this organization (all published documents otherwise). */
  organizationId: import.meta.env.VITE_SITE_ORGANIZATION_ID?.trim() || "",
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
