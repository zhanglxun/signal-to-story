/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SITE_NAME?: string
  readonly VITE_SITE_DESCRIPTION?: string
  readonly VITE_SITE_ORGANIZATION_ID?: string
  readonly VITE_SITE_DEMO?: string
}
