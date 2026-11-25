import type { ReactNode } from "react"
import { BrandMark } from "@/components/brand-mark"
import { Card, CardContent } from "@/components/ui/card"

export function AuthShell({ children }: { children: ReactNode }) {
  return <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10"><BrandMark /><Card className="w-full max-w-md"><CardContent>{children}</CardContent></Card><p className="text-xs text-muted-foreground">© susesne.cn</p></main>
}
