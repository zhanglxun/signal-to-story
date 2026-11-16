import { useEffect } from "react"

import { pageTitle } from "@/config/brand"

export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = pageTitle(title)
  }, [title])
}
