import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

import { ReaderAuthProvider } from "@/features/auth/reader-auth"
import { ThemeProvider } from "@/features/theme/theme"
import { createQueryClient } from "@/lib/query-client"

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ReaderAuthProvider>{children}</ReaderAuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
