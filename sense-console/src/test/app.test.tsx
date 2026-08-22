import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it } from "vitest"

import App from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider } from "@/features/auth/auth-provider"

function renderApp(route: string) {
  return render(<ThemeProvider defaultTheme="light"><MemoryRouter initialEntries={[route]}><AuthProvider><TooltipProvider><App /></TooltipProvider></AuthProvider></MemoryRouter></ThemeProvider>)
}

describe("console authentication shell", () => {
  beforeEach(() => sessionStorage.clear())
  it("redirects a signed-out visitor to login", async () => {
    renderApp("/dashboard")
    expect(await screen.findByRole("heading", { name: "进入内容控制中心" })).toBeInTheDocument()
  })
  it("allows the unconfigured local preview", async () => {
    renderApp("/login")
    fireEvent.click(screen.getByRole("button", { name: /进入演示工作台/ }))
    expect(await screen.findByRole("heading", { name: "内容生产驾驶舱" })).toBeInTheDocument()
    expect(screen.getByText("演示数据")).toBeInTheDocument()
  })
})
