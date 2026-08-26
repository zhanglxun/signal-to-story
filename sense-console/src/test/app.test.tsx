import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => null,
  isSupabaseConfigured: false,
}))

import App from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider } from "@/features/auth/auth-provider"
import { AppearanceProvider } from "@/features/appearance/appearance-context"

function renderApp(route: string) {
  return render(<ThemeProvider defaultTheme="light"><AppearanceProvider><MemoryRouter initialEntries={[route]}><AuthProvider><TooltipProvider><App /></TooltipProvider></AuthProvider></MemoryRouter></AppearanceProvider></ThemeProvider>)
}

describe("console authentication shell", () => {
  it("redirects a signed-out visitor to login", async () => {
    renderApp("/dashboard")
    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeInTheDocument()
  })
  it("does not expose an authentication bypass when Supabase is unconfigured", async () => {
    renderApp("/login")
    expect(screen.queryByRole("button", { name: /进入演示工作台/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "登录" })).toBeDisabled()
    expect(screen.getByText("认证尚未配置")).toBeInTheDocument()
  })
})
