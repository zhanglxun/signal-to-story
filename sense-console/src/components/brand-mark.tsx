import { cn } from "@/lib/utils"

export function BrandMark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", inverse && "text-sidebar-foreground")}>
      <div className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-[oklch(.72_.13_169)] text-[oklch(.17_.04_244)] shadow-[inset_0_0_0_1px_oklch(1_0_0/.24)]">
        <span className="text-sm font-black tracking-[-.14em]">S›</span>
        <span className="absolute -right-1 -bottom-1 size-3 rounded-full bg-[oklch(.72_.16_45)]" />
      </div>
      {!compact && (
        <div className="min-w-0 leading-none">
          <div className="truncate text-sm font-semibold tracking-[-.02em]">Signal to Story</div>
          <div className={cn("mt-1.5 text-[10px] uppercase tracking-[.18em] text-muted-foreground", inverse && "text-sidebar-foreground/55")}>Content intelligence</div>
        </div>
      )}
    </div>
  )
}
