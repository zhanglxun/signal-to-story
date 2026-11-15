import { Link, useSearchParams } from "react-router"
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { ImChannelGuide } from "@/components/intake/im-channel-guide"
import { CaptureEntryGenerator } from "@/components/quick-capture/capture-entry-generator"
import { QuickCaptureForm } from "@/components/quick-capture/quick-capture-form"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { captureRawFromParams } from "@/lib/capture-entry"

/** Minimal standalone capture page (phone "Add to Home Screen"). Requires login; outside the AppShell. */
export function CapturePage() {
  const [params] = useSearchParams()
  return (
    <div className="min-h-svh bg-background px-4 py-6 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="flex items-center justify-between">
          <BrandMark />
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/tasks" />}>
            <ArrowLeftIcon />任务中心
          </Button>
        </header>
        <div>
          <h1 className="text-xl font-semibold">速记</h1>
          <p className="mt-1 text-sm text-muted-foreground">随手收进选题池，或直接立项让 Agent 出稿到待审。</p>
        </div>
        <QuickCaptureForm autoFocus initialRaw={captureRawFromParams(params)} />
        <Collapsible className="rounded-lg border">
          <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium">更多入口（书签 / 快捷指令 / IM 机器人）<ChevronDownIcon className="size-4" /></CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 px-4 pb-4">
            <CaptureEntryGenerator />
            <ImChannelGuide />
          </CollapsibleContent>
        </Collapsible>
        <p className="text-xs text-muted-foreground">提示：在手机浏览器中选择「添加到主屏幕」即可像 App 一样打开此页。</p>
      </div>
    </div>
  )
}
