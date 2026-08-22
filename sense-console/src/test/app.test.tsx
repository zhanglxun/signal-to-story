import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider } from "@/features/auth/auth-provider"
import { AppearanceProvider } from "@/features/appearance/appearance-context"

function renderApp(route: string) {
  return render(<ThemeProvider defaultTheme="light"><AppearanceProvider><MemoryRouter initialEntries={[route]}><AuthProvider><TooltipProvider><App /></TooltipProvider></AuthProvider></MemoryRouter></AppearanceProvider></ThemeProvider>)
}

describe("console authentication shell", () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.stubEnv("VITE_ENABLE_DEMO_MODE", "true")
  })
  afterEach(() => vi.unstubAllEnvs())
  it("redirects a signed-out visitor to login", async () => {
    renderApp("/dashboard")
    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeInTheDocument()
  })
  it("allows the unconfigured local preview", async () => {
    renderApp("/login")
    fireEvent.click(screen.getByRole("button", { name: /进入演示工作台/ }))
    expect(await screen.findByRole("heading", { name: "内容生产驾驶舱" })).toBeInTheDocument()
    expect(screen.getByText("演示数据")).toBeInTheDocument()
  })
})
