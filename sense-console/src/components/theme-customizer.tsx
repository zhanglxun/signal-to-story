import { CheckIcon, MoonIcon, PaletteIcon, SunIcon } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { SHADCN_SKINS, useAppearance } from "@/features/appearance/appearance-context"
import { cn } from "@/lib/utils"

export function ThemeCustomizer() {
  const { theme, setTheme } = useTheme()
  const { skin, setSkin, radius, setRadius, customizerOpen, setCustomizerOpen } = useAppearance()

  return <Sheet open={customizerOpen} onOpenChange={setCustomizerOpen}>
    <SheetContent className="sm:max-w-sm">
      <SheetHeader className="border-b"><SheetTitle>外观设置</SheetTitle><SheetDescription>使用 shadcn/create 官方主题参数调整控制台。</SheetDescription></SheetHeader>
      <div className="space-y-6 overflow-y-auto px-4 pb-6">
        <section className="space-y-3"><div><h3 className="text-sm font-medium">主题色</h3><p className="mt-1 text-xs text-muted-foreground">官方 shadcn 主题色集合</p></div><div className="grid grid-cols-4 gap-3">{SHADCN_SKINS.map((item) => <button key={item.id} onClick={() => setSkin(item.id)} className={cn("flex flex-col items-center gap-2 rounded-lg border p-2 text-xs transition-colors hover:bg-accent", skin === item.id && "border-primary bg-accent")}><span className="relative size-7 rounded-full" style={{ backgroundColor: item.color }}>{skin === item.id && <CheckIcon className="absolute inset-0 m-auto size-3.5 text-white" />}</span><span>{item.label}</span></button>)}</div></section>
        <Separator />
        <section className="space-y-4"><div className="flex items-center justify-between"><div><h3 className="text-sm font-medium">深色模式</h3><p className="mt-1 text-xs text-muted-foreground">切换官方 light / dark tokens</p></div><div className="flex items-center gap-2"><SunIcon className="size-4 text-muted-foreground" /><Switch checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} /><MoonIcon className="size-4 text-muted-foreground" /></div></div></section>
        <Separator />
        <section className="space-y-4"><div className="flex items-center justify-between"><div><h3 className="text-sm font-medium">圆角</h3><p className="mt-1 text-xs text-muted-foreground">shadcn/create radius：{radius.toFixed(3)}rem</p></div><PaletteIcon className="size-4 text-muted-foreground" /></div><Slider min={0} max={1} step={0.125} value={[radius]} onValueChange={(value) => setRadius(Array.isArray(value) ? value[0] : value)} /></section>
        <Separator />
        <Button variant="outline" className="w-full" onClick={() => { setSkin("neutral"); setRadius(0.625); setTheme("light") }}>恢复 Base Nova 默认皮肤</Button>
      </div>
    </SheetContent>
  </Sheet>
}
