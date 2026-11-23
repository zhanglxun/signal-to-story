import { useRef, useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, ClapperboardIcon, ImagePlusIcon, PlusIcon, SaveIcon, SparklesIcon, Trash2Icon, Volume2Icon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import {
  cameraMotionLabels,
  cameraMotions,
  formatCents,
  motionModeLabels,
  motionModes,
  shotRenderStatusLabels,
  shotSizeLabels,
  shotSizes,
  type VideoShot,
  VOICE_OPTIONS,
} from "@/contracts/video-studio"
import type { VideoShotPatch } from "@/services/video-studio-service"

import { diffShotDraft, renderStatusVariant, type ShotDraft as Draft, toShotDraft as toDraft } from "./shot-draft"

export interface ShotMedia {
  audioUrl?: string | null
  videoUrl?: string | null
  keyframeUrl?: string | null
  videoPlaceholder?: boolean
}

export interface ShotCardProps {
  shot: VideoShot
  index: number
  total: number
  defaultVoice: string
  locked: boolean
  canManage: boolean
  media?: ShotMedia
  keyframeOptions?: { id: number; name: string }[]
  /** Cloud re-roll cost estimate in cents (shown before asking for approval). */
  cloudCostCents: number
  busy?: boolean
  onSave: (patch: VideoShotPatch) => void
  onUploadKeyframe?: (file: File) => void | Promise<void>
  onMove: (direction: -1 | 1) => void
  onDelete: () => void
  onInsertAfter: () => void
  onPreviewTts: () => void
  onLocalPreview: () => void
  onCloudReroll: () => void
}

export function ShotCard(props: ShotCardProps) {
  const { shot, defaultVoice } = props
  // Parent passes key={`${shot.id}:${shot.updatedKey}`} semantics via `key`, so local draft resets on server changes.
  const [draft, setDraft] = useState<Draft>(() => toDraft(shot, defaultVoice))
  const fileRef = useRef<HTMLInputElement>(null)
  const patch = diffShotDraft(shot, draft, defaultVoice)
  const dirty = Object.keys(patch).length > 0
  const disabled = !props.canManage || props.locked || props.busy
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const id = (name: string) => `shot-${shot.id}-${name}`
  const keyframeOptions = props.keyframeOptions ?? []

  return (
    <Card data-testid="shot-card">
      <CardContent className="flex flex-col gap-4 lg:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-2 lg:w-56">
          <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-muted/50">
            {props.media?.videoUrl && !props.media.videoPlaceholder ? (
              <video src={props.media.videoUrl} controls className="h-full w-full object-contain" aria-label={`镜头 ${props.index + 1} 预览`} />
            ) : props.media?.keyframeUrl ? (
              <img src={props.media.keyframeUrl} alt={`镜头 ${props.index + 1} 关键帧`} className="h-full w-full object-cover" />
            ) : (
              <ClapperboardIcon className="size-6 text-muted-foreground" aria-hidden />
            )}
          </div>
          {props.media?.videoPlaceholder ? <p className="text-xs text-muted-foreground">dry-run 占位产物（未调用付费模型）</p> : null}
          {props.media?.audioUrl ? <audio src={props.media.audioUrl} controls className="w-full" aria-label={`镜头 ${props.index + 1} 配音`} /> : null}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant={renderStatusVariant[shot.renderStatus]}>{shotRenderStatusLabels[shot.renderStatus]}</Badge>
            <span>目标 {(shot.targetDurationMs / 1000).toFixed(1)}s</span>
            {shot.actualDurationMs != null ? <span>· 旁白 {(shot.actualDurationMs / 1000).toFixed(1)}s</span> : null}
          </div>
          {shot.error ? <p className="text-xs text-destructive">{shot.error}</p> : null}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">镜 {props.index + 1}</span>
            <div className="flex flex-wrap gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="上移" disabled={disabled || props.index === 0} onClick={() => props.onMove(-1)}><ArrowUpIcon /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="下移" disabled={disabled || props.index === props.total - 1} onClick={() => props.onMove(1)}><ArrowDownIcon /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="在后面插入镜头" disabled={disabled} onClick={props.onInsertAfter}><PlusIcon /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="删除镜头" disabled={disabled || props.total <= 1} onClick={props.onDelete}><Trash2Icon /></Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={id("narration")}>旁白台词</Label>
            <Textarea id={id("narration")} value={draft.narration} disabled={disabled} maxLength={1000} rows={2} onChange={(e) => set("narration", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("prompt")}>画面描述</Label>
            <Textarea id={id("prompt")} value={draft.visualPrompt} disabled={disabled} maxLength={2000} rows={2} onChange={(e) => set("visualPrompt", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={id("voice")}>音色</Label>
              <NativeSelect id={id("voice")} className="w-full" value={draft.voice} disabled={disabled} onChange={(e) => set("voice", e.target.value)}>
                {VOICE_OPTIONS.map((v) => <NativeSelectOption key={v.value} value={v.value}>{v.label}</NativeSelectOption>)}
                {VOICE_OPTIONS.some((v) => v.value === draft.voice) ? null : <NativeSelectOption value={draft.voice}>{draft.voice}</NativeSelectOption>}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id("motion")}>运镜方式</Label>
              <NativeSelect id={id("motion")} className="w-full" value={draft.motionMode} disabled={disabled} onChange={(e) => set("motionMode", e.target.value as Draft["motionMode"])}>
                {motionModes.map((m) => <NativeSelectOption key={m} value={m}>{motionModeLabels[m]}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id("camera")}>镜头运动</Label>
              <NativeSelect id={id("camera")} className="w-full" value={draft.cameraMotion} disabled={disabled} onChange={(e) => set("cameraMotion", e.target.value as Draft["cameraMotion"])}>
                {cameraMotions.map((m) => <NativeSelectOption key={m} value={m}>{cameraMotionLabels[m]}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id("size")}>景别</Label>
              <NativeSelect id={id("size")} className="w-full" value={draft.shotSize} disabled={disabled} onChange={(e) => set("shotSize", e.target.value as Draft["shotSize"])}>
                {shotSizes.map((m) => <NativeSelectOption key={m} value={m}>{shotSizeLabels[m]}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id("duration")}>目标时长（秒）</Label>
              <Input id={id("duration")} type="number" min={0.5} max={60} step={0.5} value={draft.targetDurationMs / 1000} disabled={disabled}
                onChange={(e) => set("targetDurationMs", Math.round(Math.min(60, Math.max(0.5, Number(e.target.value) || 0.5)) * 1000))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id("sfx")}>SFX 音效</Label>
              <Input id={id("sfx")} value={draft.sfxDescription} disabled={disabled} maxLength={500} onChange={(e) => set("sfxDescription", e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor={id("keyframe")}>关键帧资产</Label>
              <NativeSelect
                id={id("keyframe")}
                className="w-full"
                value={draft.keyframeAssetId != null ? String(draft.keyframeAssetId) : ""}
                disabled={disabled}
                onChange={(e) => set("keyframeAssetId", e.target.value ? Number(e.target.value) : null)}
              >
                <NativeSelectOption value="">未绑定（本地运镜需关键帧）</NativeSelectOption>
                {keyframeOptions.map((opt) => (
                  <NativeSelectOption key={opt.id} value={String(opt.id)}>{opt.name}</NativeSelectOption>
                ))}
                {draft.keyframeAssetId != null && !keyframeOptions.some((o) => o.id === draft.keyframeAssetId) ? (
                  <NativeSelectOption value={String(draft.keyframeAssetId)}>资产 #{draft.keyframeAssetId}</NativeSelectOption>
                ) : null}
              </NativeSelect>
            </div>
            {props.onUploadKeyframe ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  aria-label={`上传镜头 ${props.index + 1} 关键帧`}
                  disabled={disabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ""
                    if (file) void props.onUploadKeyframe?.(file)
                  }}
                />
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => fileRef.current?.click()}>
                  <ImagePlusIcon data-icon="inline-start" />上传关键帧
                </Button>
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={disabled || !dirty} onClick={() => props.onSave(patch)}><SaveIcon data-icon="inline-start" />保存修改</Button>
            {dirty ? <Button size="sm" variant="ghost" onClick={() => setDraft(toDraft(shot, defaultVoice))}>撤销</Button> : null}
            <Button size="sm" variant="outline" disabled={disabled || dirty || !shot.narration.trim()} onClick={props.onPreviewTts}><Volume2Icon data-icon="inline-start" />试听配音</Button>
            {shot.motionMode === "local_ken_burns" ? (
              <Button size="sm" variant="outline" disabled={disabled || dirty} onClick={props.onLocalPreview}><ClapperboardIcon data-icon="inline-start" />本地运镜预览（免费）</Button>
            ) : (
              <Button size="sm" variant="outline" disabled={disabled || dirty} onClick={props.onCloudReroll}><SparklesIcon data-icon="inline-start" />单镜重抽 · 约 {formatCents(props.cloudCostCents)}（需批准）</Button>
            )}
          </div>
          {dirty ? <p className="text-xs text-muted-foreground">保存后分镜版本 +1，旧版本的批准会自动失效。</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}
