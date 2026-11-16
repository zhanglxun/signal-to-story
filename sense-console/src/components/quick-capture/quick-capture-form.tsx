import { useRef, useState } from "react"
import { Link } from "react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BookmarkPlusIcon, CheckCircle2Icon, LinkIcon, SparklesIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { platformKeys, platforms as platformLabels, type Platform } from "@/contracts/content"
import { newCaptureIdempotencyKey, parseCaptureInput, type QuickCaptureIntent, type QuickCaptureResult } from "@/contracts/quick-capture"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { submitQuickCapture } from "@/services/quick-capture-service"

const KIND_LABEL = { empty: "", url: "链接", text: "想法", url_with_note: "链接 + 备注" } as const

export interface QuickCaptureFormProps {
  /** Override for tests / embedding; defaults to the caller's workspace organization. */
  organizationId?: string
  submit?: typeof submitQuickCapture
  onNavigate?: () => void
  autoFocus?: boolean
  /** Prefill (e.g. from the browser bookmarklet via /capture?u=…&t=…). */
  initialRaw?: string
}

export function QuickCaptureForm({ organizationId: orgOverride, submit = submitQuickCapture, onNavigate, autoFocus, initialRaw }: QuickCaptureFormProps) {
  const queryClient = useQueryClient()
  const workspace = useQuery({ queryKey: ["content-workspace"], queryFn: getContentWorkspace, enabled: !orgOverride })
  const organizationId = orgOverride ?? workspace.data?.organization?.id
  const [raw, setRaw] = useState(initialRaw ?? "")
  const [intent, setIntent] = useState<QuickCaptureIntent>("capture_only")
  const [selected, setSelected] = useState<Platform[]>([])
  const [result, setResult] = useState<QuickCaptureResult | null>(null)
  // One key per distinct submission: a retry of the same input reuses it (server dedupes), any edit resets it.
  const keyRef = useRef<string | null>(null)
  const inFlight = useRef(false)
  const parsed = parseCaptureInput(raw)

  const mutation = useMutation({
    mutationFn: submit,
    onSuccess: (data) => {
      setResult(data)
      keyRef.current = null
      setRaw("")
      void queryClient.invalidateQueries({ queryKey: ["agent-jobs"] })
    },
    onSettled: () => {
      inFlight.current = false
    },
  })

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    keyRef.current = null
    mutation.reset()
    setter(v)
  }

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (inFlight.current || !organizationId || parsed.kind === "empty") return
    inFlight.current = true
    keyRef.current ??= newCaptureIdempotencyKey()
    setResult(null)
    mutation.mutate({ organizationId, url: parsed.url, note: parsed.note, intent, platforms: intent === "auto_draft" ? selected : [], idempotencyKey: keyRef.current })
  }

  if (!orgOverride && workspace.isSuccess && !organizationId) {
    return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织初始化。</AlertDescription></Alert>
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} aria-label="速记">
      <div className="space-y-2">
        <Label htmlFor="quick-capture-input">链接或一句话想法</Label>
        <Textarea
          id="quick-capture-input"
          autoFocus={autoFocus}
          rows={4}
          maxLength={4600}
          placeholder="粘贴链接，可在后面补一句你的角度；也可以只写一个想法"
          value={raw}
          onChange={(e) => edit(setRaw)(e.target.value)}
        />
        {parsed.kind !== "empty" && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{KIND_LABEL[parsed.kind]}</Badge>
            {parsed.url && <span className="inline-flex min-w-0 items-center gap-1 truncate"><LinkIcon className="size-3 shrink-0" />{parsed.url}</span>}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="意图">
        <Button type="button" variant={intent === "capture_only" ? "default" : "outline"} aria-pressed={intent === "capture_only"} onClick={() => edit(setIntent)("capture_only")}>
          <BookmarkPlusIcon />仅收录
        </Button>
        <Button type="button" variant={intent === "auto_draft" ? "default" : "outline"} aria-pressed={intent === "auto_draft"} onClick={() => edit(setIntent)("auto_draft")}>
          <SparklesIcon />自动出稿到待审
        </Button>
      </div>

      {intent === "auto_draft" && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">母稿之外再生成这些平台稿（可不选）</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {platformKeys.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(p)}
                  onCheckedChange={(checked) => edit(setSelected)(checked ? [...selected, p] : selected.filter((x) => x !== p))}
                />
                {platformLabels[p]}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Agent 只产出提案，需你在稿件页采纳并审核；不会自动发布。</p>
        </fieldset>
      )}

      {mutation.isError && (
        <Alert variant="destructive"><AlertTitle>没有保存</AlertTitle><AlertDescription>{(mutation.error as Error).message} 可直接重试，不会重复创建。</AlertDescription></Alert>
      )}

      {result && (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>{result.duplicate ? "已收录过（返回原结果）" : result.intent === "auto_draft" ? `已立项，${result.documents.length} 篇稿件进入出稿队列` : "已收进选题池"}</AlertTitle>
          <AlertDescription className="flex flex-wrap gap-3">
            <Link to={result.topicPath} onClick={onNavigate}>查看选题</Link>
            {result.projectPath && <Link to={result.projectPath} onClick={onNavigate}>打开内容项目</Link>}
            {result.documents.length > 0 && <Link to="/tasks" onClick={onNavigate}>查看任务进度</Link>}
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={mutation.isPending || parsed.kind === "empty" || !organizationId}>
        {mutation.isPending ? <><Spinner />提交中</> : intent === "auto_draft" ? "收录并自动出稿" : "收录"}
      </Button>
    </form>
  )
}
