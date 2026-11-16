import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { safeStorage } from "@/lib/format"

type Theme = "light" | "dark"
const STORAGE_KEY = "sense-site.theme"
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null)

function initialTheme(): Theme {
  try {
    const stored = safeStorage()?.getItem(STORAGE_KEY)
    if (stored === "light" || stored === "dark") return stored
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  } catch {
    return "light"
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark"
      try {
        safeStorage()?.setItem(STORAGE_KEY, next)
      } catch {
        // Preference is a convenience only.
      }
      return next
    })
  }, [])
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("useTheme must be used inside ThemeProvider")
  return value
}
