import { cn } from "@/lib/utils"

export function BrandMark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", inverse && "text-sidebar-foreground")}>
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <span className="text-xs font-semibold">S²</span>
      </div>
      {!compact && (
        <div className="min-w-0 leading-none">
          <div className="truncate text-sm font-semibold tracking-[-.02em]">Signal to Story</div>
          <div className={cn("mt-1.5 text-[10px] text-muted-foreground", inverse && "text-sidebar-foreground/60")}>Content Console</div>
        </div>
      )}
    </div>
  )
}
