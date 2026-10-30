import { createContext, useContext, type ReactNode } from "react"

import type { CatalogService } from "@/contracts/site"
import { isSupabaseConfigured } from "@/lib/supabase"
import { createDisconnectedCatalog, createSupabaseCatalog } from "@/services/supabase-catalog"

const CatalogContext = createContext<CatalogService | null>(null)

function createDefaultCatalog(): CatalogService {
  if (isSupabaseConfigured()) {
    try {
      return createSupabaseCatalog()
    } catch {
      return createDisconnectedCatalog()
    }
  }
  return createDisconnectedCatalog()
}

const defaultCatalog = createDefaultCatalog()

export function CatalogProvider({
  service = defaultCatalog,
  children,
}: {
  service?: CatalogService
  children: ReactNode
}) {
  return <CatalogContext.Provider value={service}>{children}</CatalogContext.Provider>
}

export function useCatalog() {
  const catalog = useContext(CatalogContext)
  if (!catalog) throw new Error("useCatalog 需要放在 CatalogProvider 里")
  return catalog
}
