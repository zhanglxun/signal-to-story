import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter } from "react-router"

import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/features/auth/auth-provider"
import { queryClient } from "@/lib/query-client"
import { CatalogProvider } from "@/services/catalog"
import { App } from "./App.tsx"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="signal-to-story.site.theme">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <CatalogProvider>
              <App />
            </CatalogProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
