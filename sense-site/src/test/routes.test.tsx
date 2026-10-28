import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { MemoryRouter } from "react-router"
import { describe, expect, it } from "vitest"

import { App } from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import type { CatalogService } from "@/contracts/site"
import { AuthProvider } from "@/features/auth/auth-provider"
import { createStubCatalog } from "@/services/stub-catalog"
import { CatalogProvider } from "@/services/catalog"

function renderSite(path: string, service?: CatalogService) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider defaultTheme="light" storageKey="sense-site.test.theme">
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <AuthProvider>
              <CatalogProvider service={service}>{children}</CatalogProvider>
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    )
  }
  return render(<App />, { wrapper: Wrapper })
}

describe("reader routes", () => {
  it("renders the home shell", async () => {
    renderSite("/")
    expect(await screen.findByRole("heading", { name: "把已发布的内容读清楚" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "批准之后，站点才看得到" })).toBeInTheDocument()
    expect(screen.getByText("开发占位数据，不是已发布内容。直达链接只验证路由和版面。")).toBeInTheDocument()
  })

  it("shows an empty explore result from the url", async () => {
    renderSite("/explore?category=lab")
    expect(await screen.findByText("没有符合条件的内容")).toBeInTheDocument()
  })

  it("shows a not found page and a catalog error with retry", async () => {
    renderSite("/missing")
    expect(await screen.findByRole("heading", { name: "找不到这个页面" })).toBeInTheDocument()
  })

  it("shows retry when the catalog fails", async () => {
    renderSite("/content/status-error")
    expect(await screen.findByRole("alert")).toHaveTextContent("内容暂时没有加载出来")
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("keeps registered body text out of the anonymous page", async () => {
    renderSite("/content/model-limits")
    expect(await screen.findByRole("heading", { name: "注册后阅读全文" })).toBeInTheDocument()
    expect(screen.getAllByText(/模型会犯错/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/版式占位/)).not.toBeInTheDocument()
  })

  it("sends /me to login and accepts a preview session", async () => {
    const user = userEvent.setup()
    renderSite("/me")
    expect(await screen.findByRole("heading", { name: "登录" })).toBeInTheDocument()
    await user.type(screen.getByLabelText("邮箱"), "reader@example.com")
    await user.type(screen.getByLabelText("密码"), "preview-pass")
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: "登录" }))
    expect(await screen.findByRole("heading", { name: "我的" })).toBeInTheDocument()
    expect(within(screen.getByRole("main")).getByText(/本地预览会话，没有后台权限/)).toBeInTheDocument()
  })

  it("shows the loading state", () => {
    const pending = new Promise<never>(() => {})
    const service: CatalogService = {
      ...createStubCatalog(),
      listEntries: () => pending,
      listTopics: () => pending,
    }
    renderSite("/", service)
    expect(screen.getByRole("status")).toHaveTextContent("正在加载内容")
  })
})
