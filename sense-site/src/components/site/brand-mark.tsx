import { brandConfig } from "@/config/brand"

export function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <span className="text-xs font-semibold">S²</span>
      </span>
      <span className="min-w-0 leading-none">
        <span className="block truncate text-sm font-semibold tracking-[-.01em]">{brandConfig.chineseName}</span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">{brandConfig.englishName}</span>
      </span>
    </span>
  )
}
