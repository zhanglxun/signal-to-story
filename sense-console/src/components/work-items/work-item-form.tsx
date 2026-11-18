import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/content/content-common'
import { CategorySelect } from '@/components/source-categories/category-select'
import type { SourceCategory } from '@/contracts/source-category'
import { aspectRatios, contentKindLabels, workItemKindLabels, workItemKinds, type WorkItemInput } from '@/contracts/work-item'

/**
 * 新建 / 编辑事项。Brief 文本、内容类型、时长、比例写进 brief jsonb，由 service 与原 brief 合并。
 * onSave 返回新的 updated_at 时，表单用它作为下一次乐观更新的基准。
 */
export function WorkItemForm({ initial, categories, busy, submitLabel = '保存事项', onSave }: {
  initial: WorkItemInput & { updated_at?: string }
  categories: SourceCategory[]
  busy: boolean
  submitLabel?: string
  onSave: (input: WorkItemInput, baseUpdatedAt?: string) => Promise<string | void>
}) {
  const [value, setValue] = useState<WorkItemInput>(initial)
  const [baseUpdatedAt, setBaseUpdatedAt] = useState(initial.updated_at)
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); void onSave(value, baseUpdatedAt).then(updatedAt => { if (updatedAt) setBaseUpdatedAt(updatedAt) }) }}>
    <Field label="标题"><Input required maxLength={200} value={value.title} onChange={e => setValue({ ...value, title: e.target.value })} /></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="产出形态"><NativeSelect value={value.kind} onChange={e => setValue({ ...value, kind: e.target.value as WorkItemInput['kind'] })}>{workItemKinds.map(k => <option key={k} value={k}>{workItemKindLabels[k]}</option>)}</NativeSelect></Field>
      <Field label="分类"><CategorySelect categories={categories} value={value.category_id} onChange={category_id => setValue({ ...value, category_id })} allOptionLabel="不分类" /></Field>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="内容类型"><NativeSelect value={value.content_kind} onChange={e => setValue({ ...value, content_kind: e.target.value as WorkItemInput['content_kind'] })}>{Object.entries(contentKindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></Field>
      <Field label="目标时长（秒）"><Input type="number" min={1} max={3600} required value={value.target_seconds} onChange={e => setValue({ ...value, target_seconds: Number(e.target.value) })} /></Field>
      <Field label="画面比例"><NativeSelect value={value.aspect_ratio} onChange={e => setValue({ ...value, aspect_ratio: e.target.value as WorkItemInput['aspect_ratio'] })}>{aspectRatios.map(v => <option key={v}>{v}</option>)}</NativeSelect></Field>
    </div>
    <Field label="Brief"><Textarea className="min-h-32" maxLength={20000} value={value.text} placeholder="受众、核心观点、证据来源、表达风格、目标平台…" onChange={e => setValue({ ...value, text: e.target.value })} /></Field>
    <Button disabled={busy} type="submit">{busy ? '正在保存…' : submitLabel}</Button>
  </form>
}
