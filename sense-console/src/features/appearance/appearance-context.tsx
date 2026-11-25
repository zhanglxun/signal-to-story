/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

export type SkinId = "neutral" | "red" | "rose" | "orange" | "green" | "blue" | "yellow" | "violet"
export type RailStyle = "colored" | "light"

type Skin = {
  id: SkinId
  label: string
  color: string
  light: [string, string, string]
  dark: [string, string, string]
}

export const SHADCN_SKINS: Skin[] = [
  { id: "neutral", label: "Neutral", color: "#18181b", light: ["oklch(0.205 0 0)", "oklch(0.985 0 0)", "oklch(0.708 0 0)"], dark: ["oklch(0.922 0 0)", "oklch(0.205 0 0)", "oklch(0.556 0 0)"] },
  { id: "red", label: "Red", color: "#dc2626", light: ["#dc2626", "#ffffff", "#dc2626"], dark: ["#ef4444", "#ffffff", "#ef4444"] },
  { id: "rose", label: "Rose", color: "#e11d48", light: ["#e11d48", "#ffffff", "#e11d48"], dark: ["#f43f5e", "#ffffff", "#f43f5e"] },
  { id: "orange", label: "Orange", color: "#ea580c", light: ["#ea580c", "#ffffff", "#ea580c"], dark: ["#f97316", "#ffffff", "#f97316"] },
  { id: "green", label: "Green", color: "#16a34a", light: ["#16a34a", "#ffffff", "#16a34a"], dark: ["#22c55e", "#052e16", "#22c55e"] },
  { id: "blue", label: "Blue", color: "#2563eb", light: ["#2563eb", "#ffffff", "#2563eb"], dark: ["#3b82f6", "#eff6ff", "#3b82f6"] },
  { id: "yellow", label: "Yellow", color: "#ca8a04", light: ["#ca8a04", "#ffffff", "#ca8a04"], dark: ["#facc15", "#422006", "#facc15"] },
  { id: "violet", label: "Violet", color: "#7c3aed", light: ["#7c3aed", "#ffffff", "#7c3aed"], dark: ["#8b5cf6", "#f5f3ff", "#8b5cf6"] },
]

type AppearanceContextValue = {
  skin: SkinId
  setSkin: (skin: SkinId) => void
  radius: number
  setRadius: (radius: number) => void
  railStyle: RailStyle
  setRailStyle: (railStyle: RailStyle) => void
  customizerOpen: boolean
  setCustomizerOpen: (open: boolean) => void
}

const AppearanceContext = React.createContext<AppearanceContextValue | null>(null)

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkin] = React.useState<SkinId>(() => (localStorage.getItem("signal-to-story.skin") as SkinId) || "neutral")
  const [radius, setRadius] = React.useState(() => Number(localStorage.getItem("signal-to-story.radius") || 0.625))
  const [railStyle, setRailStyle] = React.useState<RailStyle>(() => localStorage.getItem("signal-to-story.rail-style") === "light" ? "light" : "colored")
  const [customizerOpen, setCustomizerOpen] = React.useState(false)

  React.useEffect(() => {
    const selected = SHADCN_SKINS.find((item) => item.id === skin) || SHADCN_SKINS[0]
    const root = document.documentElement
    root.style.setProperty("--skin-primary-light", selected.light[0])
    root.style.setProperty("--skin-primary-foreground-light", selected.light[1])
    root.style.setProperty("--skin-ring-light", selected.light[2])
    root.style.setProperty("--skin-sidebar-primary-light", selected.light[0])
    root.style.setProperty("--skin-sidebar-primary-foreground-light", selected.light[1])
    root.style.setProperty("--skin-primary-dark", selected.dark[0])
    root.style.setProperty("--skin-primary-foreground-dark", selected.dark[1])
    root.style.setProperty("--skin-ring-dark", selected.dark[2])
    root.style.setProperty("--skin-sidebar-primary-dark", selected.dark[0])
    root.style.setProperty("--skin-sidebar-primary-foreground-dark", selected.dark[1])
    localStorage.setItem("signal-to-story.skin", skin)
  }, [skin])

  React.useEffect(() => {
    document.documentElement.style.setProperty("--radius", `${radius}rem`)
    localStorage.setItem("signal-to-story.radius", String(radius))
  }, [radius])

  React.useEffect(() => {
    localStorage.setItem("signal-to-story.rail-style", railStyle)
  }, [railStyle])

  const value = React.useMemo(() => ({ skin, setSkin, radius, setRadius, railStyle, setRailStyle, customizerOpen, setCustomizerOpen }), [customizerOpen, radius, railStyle, skin])
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance() {
  const context = React.useContext(AppearanceContext)
  if (!context) throw new Error("useAppearance must be used inside AppearanceProvider")
  return context
}
