import { useState } from "react"
import { CalendarPlusIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { platforms } from "@/contracts/content"
import type { VideoPublishEligibility } from "@/lib/video-publish-plan"

/** Video studio -> publish plan entry. Disabled with an explicit reason when no approved platform draft can carry the video. */
export function PublishPlanPanel({ eligibility, canPublish, busy, onPlan }: {
  eligibility: VideoPublishEligibility
  canPublish: boolean
  busy?: boolean
  onPlan: (input: { documentId: string; channelId: string; scheduledAt: string }) => void
}) {
  const candidates = eligibility.ok ? eligibility.candidates : []
  const [documentId, setDocumentId] = useState("")
  const [channelId, setChannelId] = useState("")
  const [scheduledAt, setScheduledAt] = useState("")
  const current = candidates.find((c) => c.document.id === documentId) ?? candidates[0]
  const channel = current?.channels.find((c) => c.id === channelId) ?? current?.channels[0]
  const disabledReason = !eligibility.ok ? eligibility.reason : !canPublish ? "需要发布权限才能创建发布计划。" : !scheduledAt ? "请选择计划发布时间。" : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarPlusIcon className="size-4" />加入发布计划</CardTitle>
        <CardDescription>为关联内容项目下已审核的平台稿创建一条「计划中」的发布记录，并附上成片资产；实际发布仍由人工完成。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {eligibility.ok ? (
          <div className="flex flex-wrap items-center gap-3">
            <NativeSelect aria-label="选择平台稿" value={current?.document.id ?? ""} onChange={(e) => { setDocumentId(e.target.value); setChannelId("") }}>
              {candidates.map((c) => <NativeSelectOption key={c.document.id} value={c.document.id}>{platforms[c.document.platform as keyof typeof platforms] ?? c.document.platform} · {c.document.title}（v{c.document.revision}）</NativeSelectOption>)}
            </NativeSelect>
            <NativeSelect aria-label="选择发布账号" value={channel?.id ?? ""} onChange={(e) => setChannelId(e.target.value)}>
              {(current?.channels ?? []).map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}
            </NativeSelect>
            <Input aria-label="计划发布时间" type="datetime-local" className="w-auto" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
        ) : null}
        {disabledReason && (!eligibility.ok || !canPublish) ? <Alert><AlertDescription>{disabledReason}</AlertDescription></Alert> : null}
        <Button disabled={busy || Boolean(disabledReason) || !current || !channel} onClick={() => current && channel && onPlan({ documentId: current.document.id, channelId: channel.id, scheduledAt })}>
          <CalendarPlusIcon />加入发布计划
        </Button>
      </CardContent>
    </Card>
  )
}
