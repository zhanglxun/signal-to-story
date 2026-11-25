import { useId, useState } from "react"

import { CategorySelect } from "@/components/source-categories/category-select"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { SourceCategory } from "@/contracts/source-category"
import {
  aspectRatios,
  contentKindLabels,
  workItemKindLabels,
  workItemKinds,
  type WorkItemInput,
} from "@/contracts/work-item"

const aspectRatioItems = Object.fromEntries(aspectRatios.map((r) => [r, r]))

/**
 * 新建 / 编辑事项。Brief 文本、内容类型、时长、比例写进 brief jsonb，由 service 与原 brief 合并。
 * onSave 返回新的 updated_at 时，表单用它作为下一次乐观更新的基准。
 */
export function WorkItemForm({
  initial,
  categories,
  busy,
  submitLabel = "保存事项",
  onSave,
}: {
  initial: WorkItemInput & { updated_at?: string }
  categories: SourceCategory[]
  busy: boolean
  submitLabel?: string
  onSave: (input: WorkItemInput, baseUpdatedAt?: string) => Promise<string | void>
}) {
  const titleId = useId()
  const kindId = useId()
  const categoryId = useId()
  const contentKindId = useId()
  const secondsId = useId()
  const ratioId = useId()
  const briefId = useId()

  const [value, setValue] = useState<WorkItemInput>(initial)
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(initial.updated_at)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void onSave(value, baseUpdatedAt).then((updatedAt) => {
          if (updatedAt) setBaseUpdatedAt(updatedAt)
        })
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={titleId}>标题</FieldLabel>
          <Input
            id={titleId}
            required
            maxLength={200}
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={kindId}>产出形态</FieldLabel>
            <Select
              items={workItemKindLabels}
              value={value.kind}
              onValueChange={(next) =>
                next &&
                setValue({ ...value, kind: next as WorkItemInput["kind"] })
              }
            >
              <SelectTrigger id={kindId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workItemKinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {workItemKindLabels[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor={categoryId}>分类</FieldLabel>
            <CategorySelect
              id={categoryId}
              categories={categories}
              value={value.category_id}
              onChange={(category_id) => setValue({ ...value, category_id })}
              allOptionLabel="不分类"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor={contentKindId}>内容类型</FieldLabel>
            <Select
              items={contentKindLabels}
              value={value.content_kind}
              onValueChange={(next) =>
                next &&
                setValue({
                  ...value,
                  content_kind: next as WorkItemInput["content_kind"],
                })
              }
            >
              <SelectTrigger id={contentKindId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(contentKindLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor={secondsId}>目标时长（秒）</FieldLabel>
            <Input
              id={secondsId}
              type="number"
              min={1}
              max={3600}
              required
              value={value.target_seconds}
              onChange={(e) =>
                setValue({ ...value, target_seconds: Number(e.target.value) })
              }
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={ratioId}>画面比例</FieldLabel>
            <Select
              items={aspectRatioItems}
              value={value.aspect_ratio}
              onValueChange={(next) =>
                next &&
                setValue({
                  ...value,
                  aspect_ratio: next as WorkItemInput["aspect_ratio"],
                })
              }
            >
              <SelectTrigger id={ratioId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {aspectRatios.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor={briefId}>Brief</FieldLabel>
          <Textarea
            id={briefId}
            className="min-h-32"
            maxLength={20000}
            value={value.text}
            placeholder="受众、核心观点、证据来源、表达风格、目标平台…"
            onChange={(e) => setValue({ ...value, text: e.target.value })}
          />
        </Field>

        <div>
          <Button disabled={busy} type="submit">
            {busy ? "正在保存…" : submitLabel}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
