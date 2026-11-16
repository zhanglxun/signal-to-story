import { CornerDownRightIcon, FolderIcon, LayersIcon } from "lucide-react"

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { buildSourceCategoryTree, type SourceCategory } from "@/contracts/source-category"

const ALL_VALUE = "__all__"

/**
 * The one shared category picker for the whole app. Any dropdown that lets
 * someone choose a `source_categories` row — a filter, a create/edit form
 * field, a future storyboard/asset category field, whatever — should render
 * this instead of hand-rolling another `NativeSelect`/`Select` over the
 * category list. See `docs/frontend-conventions.md` for the rule.
 *
 * Renders each top-level category as a selectable item followed by its
 * children indented underneath, so the two-level hierarchy from
 * `source_categories.parent_id` stays visible in the closed trigger and the
 * open list alike.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  placeholder = "选择分类",
  allOptionLabel,
  id,
  className,
  ariaLabel,
}: {
  categories: SourceCategory[]
  value: number | null
  onChange: (value: number | null) => void
  placeholder?: string
  /** When set, renders a leading option (e.g. "全部分类") that resolves to `null` — use for filters, omit for required form fields. */
  allOptionLabel?: string
  id?: string
  className?: string
  ariaLabel?: string
}) {
  const tree = buildSourceCategoryTree(categories)

  // Base UI's `Select.Value` only shows the raw value string unless `items`
  // (a value → label map) is passed to the root — without it, picking a
  // category would show its numeric id instead of its name in the trigger.
  const itemLabels: Record<string, string> = {}
  if (allOptionLabel) itemLabels[ALL_VALUE] = allOptionLabel
  for (const parent of tree) {
    itemLabels[String(parent.id)] = parent.name
    for (const child of parent.children) itemLabels[String(child.id)] = child.name
  }

  return (
    <Select
      items={itemLabels}
      value={value === null ? (allOptionLabel ? ALL_VALUE : undefined) : String(value)}
      onValueChange={(next) => {
        if (next === null) return
        onChange(next === ALL_VALUE ? null : Number(next))
      }}
    >
      <SelectTrigger id={id} className={className ?? "w-full"} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allOptionLabel && (
          <SelectItem value={ALL_VALUE}>
            <LayersIcon className="text-muted-foreground" />
            {allOptionLabel}
          </SelectItem>
        )}
        {tree.map((parent) => (
          <SelectGroup key={parent.id}>
            <SelectItem value={String(parent.id)}>
              <FolderIcon className="text-muted-foreground" />
              {parent.name}
            </SelectItem>
            {parent.children.map((child) => (
              <SelectItem key={child.id} value={String(child.id)} className="pl-7">
                <CornerDownRightIcon className="size-3.5 text-muted-foreground" />
                {child.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
