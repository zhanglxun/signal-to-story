import type { ReactNode } from "react"
import { BrandMark } from "@/components/brand-mark"

export function AuthShell({ children }: { children: ReactNode }) {
  return <main className="relative grid min-h-svh overflow-hidden bg-background lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
      <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_25%_20%,oklch(.72_.13_169)_0,transparent_27%),radial-gradient(circle_at_85%_80%,oklch(.7_.17_45)_0,transparent_25%)]" />
      <div className="surface-grid absolute inset-0 opacity-10" />
      <div className="relative"><BrandMark inverse /></div>
      <div className="relative max-w-xl">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[.24em] text-emerald-300">From signal to screen</p>
        <h1 className="text-balance text-5xl font-semibold leading-[1.08] tracking-[-.055em]">把分散的信号，组织成可以生产的故事。</h1>
        <p className="mt-6 max-w-lg text-base leading-7 text-sidebar-foreground/62">连接选题判断、Agent 执行和多媒体资产，让每一步进展与关系都清晰可见。</p>
      </div>
      <div className="relative flex items-center justify-between text-xs text-sidebar-foreground/38"><span>Signal to Story Console</span><span>© susesne.cn</span></div>
    </section>
    <section className="flex items-center justify-center p-5 sm:p-10">
      <div className="w-full max-w-md"><div className="mb-10 lg:hidden"><BrandMark /></div>{children}</div>
    </section>
  </main>
}
