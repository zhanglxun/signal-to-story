import { useState } from "react"
import { CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { buildBookmarklet, buildShortcutConfig, intakeEndpoint } from "@/lib/capture-entry"

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard may be unavailable (insecure context); the text stays selectable in the box.
  }
}

/** Generates a browser bookmarklet and iOS Shortcut setup. The pasted token lives in state only; nothing is stored. */
export function CaptureEntryGenerator({ supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined, consoleOrigin = typeof window === "undefined" ? "" : window.location.origin }: { supabaseUrl?: string; consoleOrigin?: string }) {
  const [token, setToken] = useState("")
  const bookmarklet = buildBookmarklet(consoleOrigin)
  const shortcut = buildShortcutConfig({ endpoint: intakeEndpoint(supabaseUrl), token })
  const shortcutText = JSON.stringify({ url: shortcut.endpoint, method: shortcut.method, headers: shortcut.headers, body: shortcut.body }, null, 2)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>浏览器书签</CardTitle>
          <CardDescription>把下方按钮拖到书签栏。在任意网页点击它，会打开本页并带入当前网址与标题；使用你已登录的账号收录，书签中不含任何令牌。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <a href={bookmarklet} onClick={(e) => e.preventDefault()} draggable className="inline-block rounded-md border px-3 py-1.5 text-sm font-medium" data-testid="bookmarklet-link">收进星火工厂</a>
          <p className="text-xs text-muted-foreground">收录接口不接受浏览器跨域直调，因此书签只负责把网址带到登录后的速记页。</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>iOS 快捷指令（分享菜单）</CardTitle>
          <CardDescription>在「系统管理 → 外部接入」创建收录令牌后粘贴到这里，仅用于生成下方配置，不会被保存或上传。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="shortcut-token">收录令牌</Label>
            <Input id="shortcut-token" type="password" autoComplete="off" placeholder="stk_…" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{shortcut.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-3 text-xs" data-testid="shortcut-config">{shortcutText}</pre>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy(shortcutText)}><CopyIcon />复制配置</Button>
          <p className="text-xs text-muted-foreground">令牌等同密码：不要截图或分享快捷指令；泄露后请在外部接入页撤销。</p>
        </CardContent>
      </Card>
    </div>
  )
}
