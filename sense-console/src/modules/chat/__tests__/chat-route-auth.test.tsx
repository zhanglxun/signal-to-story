import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: () => null,
  isSupabaseConfigured: false,
  getSupabaseEndpointHostname: () => null,
}))

import App from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppearanceProvider } from "@/features/appearance/appearance-context"
import { AuthContext, type AuthContextValue } from "@/features/auth/auth-context"
import { AuthProvider } from "@/features/auth/auth-provider"

beforeAll(() => {
  if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => undefined
  }
  if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function Providers({ path, children }: { path: string; children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <ThemeProvider defaultTheme="light">
      <AppearanceProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <TooltipProvider>{children}</TooltipProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </AppearanceProvider>
    </ThemeProvider>
  )
}

const SIGNED_IN: AuthContextValue = {
  user: { id: "mock-user-1", email: "operator@example.test", displayName: "Operator" },
  isLoading: false,
  isConfigured: true,
  isRecoverySession: false,
  signIn: async () => undefined,
  signOut: async () => undefined,
  resetPassword: async () => undefined,
  updateDisplayName: async () => undefined,
  updatePassword: async () => undefined,
}

describe("chat routes", () => {
  it.each(["/chat", "/h5/chat"])("redirects a signed-out visitor on %s to /login", async (path) => {
    render(
      <Providers path={path}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Providers>
    )
    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeInTheDocument()
  })

  it("removed /chat-next", async () => {
    render(
      <Providers path="/chat-next">
        <AuthContext.Provider value={SIGNED_IN}>
          <App />
        </AuthContext.Provider>
      </Providers>
    )
    expect(await screen.findByText("这个故事线索不存在")).toBeInTheDocument()
  })

  it("renders the new ChatPage inside the console shell on /chat", async () => {
    vi.stubEnv("VITE_CHAT_TRANSPORT", "mock")
    render(
      <Providers path="/chat">
        <AuthContext.Provider value={SIGNED_IN}>
          <App />
        </AuthContext.Provider>
      </Providers>
    )
    expect(await screen.findByLabelText("聊天消息输入框")).toBeInTheDocument()
    // Inside AppShell: the console header and navigation are present; the H5 switch links out.
    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /H5 窄屏/ })).toHaveAttribute("href", "/h5/chat")
  })

  it("renders the same ChatPage full-screen on /h5/chat, outside the shell", async () => {
    vi.stubEnv("VITE_CHAT_TRANSPORT", "mock")
    const { container } = render(
      <Providers path="/h5/chat">
        <AuthContext.Provider value={SIGNED_IN}>
          <App />
        </AuthContext.Provider>
      </Providers>
    )
    expect(await screen.findByLabelText("聊天消息输入框")).toBeInTheDocument()
    expect(screen.queryByRole("main")).not.toBeInTheDocument()
    const desktopLink = screen.getByRole("button", { name: /桌面视图/ })
    expect(desktopLink).toHaveAttribute("href", "/chat")
    expect(within(container).getByRole("button", { name: /工作台/ })).toHaveAttribute("href", "/dashboard")
  })
})
