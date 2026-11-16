import { useId } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { memoryPlatformLabels } from "@/contracts/decision-memory"
import type { RememberDecisionValue } from "@/lib/remember-decision"

/**
 * "记入长期创作偏好（Decision Memory）" block shared by the review and retrospective forms.
 * Controlled; the parent turns the value into a decision_memories row with buildDecisionMemoryInput.
 */
export function RememberDecisionField({
  value,
  onChange,
  platform,
  hint,
  summaryPlaceholder = "留空则使用上方填写的原话",
  disabled,
}: {
  value: RememberDecisionValue
  onChange: (next: RememberDecisionValue) => void
  /** Platform key of the draft; shown as the default scope. null = no platform scope offered. */
  platform: string | null
  hint?: string
  summaryPlaceholder?: string
  disabled?: boolean
}) {
  const id = useId()
  const platformLabel = platform ? (memoryPlatformLabels[platform] ?? platform) : null
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-enabled`}
          checked={value.enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...value, enabled: Boolean(checked) })}
        />
        <Label htmlFor={`${id}-enabled`}>记入长期创作偏好（Decision Memory）</Label>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {value.enabled && (
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-2">
            <Label htmlFor={`${id}-summary`}>偏好摘要（可编辑，原话会一并保留）</Label>
            <Textarea
              id={`${id}-summary`}
              maxLength={500}
              rows={2}
              value={value.summary}
              disabled={disabled}
              placeholder={summaryPlaceholder}
              onChange={(e) => onChange({ ...value, summary: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-scope`}>适用范围</Label>
            <NativeSelect
              id={`${id}-scope`}
              value={value.scope}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, scope: e.target.value === "global" ? "global" : "platform" })}
            >
              {platformLabel && <option value="platform">仅{platformLabel}</option>}
              <option value="global">全局（所有平台）</option>
            </NativeSelect>
          </div>
        </div>
      )}
    </div>
  )
}
