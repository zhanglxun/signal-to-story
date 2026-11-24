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
import { AppearanceProvider } from "@/features/appearance/appearance-context"
import { AuthProvider } from "@/features/auth/auth-provider"

describe("/chat-next route protection", () => {
  it("redirects signed-out visitor on /chat-next to /login via RequireAuth in non-mock builds", async () => {
    render(
      <ThemeProvider defaultTheme="light">
        <AppearanceProvider>
          <MemoryRouter initialEntries={["/chat-next"]}>
            <AuthProvider>
              <TooltipProvider>
                <App />
              </TooltipProvider>
            </AuthProvider>
          </MemoryRouter>
        </AppearanceProvider>
      </ThemeProvider>
    )

    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeInTheDocument()
  })
})
