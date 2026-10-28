import { createContext, useContext, type ReactNode } from "react"

import type { CatalogService } from "@/contracts/site"
import { createStubCatalog } from "@/services/stub-catalog"

const CatalogContext = createContext<CatalogService | null>(null)
const defaultCatalog = createStubCatalog()

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
