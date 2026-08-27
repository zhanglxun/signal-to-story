# 前端复用组件约定

记录"同一类交互，全项目只允许一个实现"的规则。数据库表结构规则在 `docs/supabase-data-model.md`；这里只管前端组件复用。

## 分类层级选择器：统一用 `CategorySelect`

组件位置：`src/components/source-categories/category-select.tsx`。

`source_categories` 是 `parent_id` 自关联的两层结构（分类管理见 `docs/supabase-data-model.md`）。任何需要"选一个分类"的下拉——筛选器、表单字段、以后可能出现的场景/道具/角色的分类字段——**必须**使用这个组件，不允许各自用 `NativeSelect`/`Select` 手写一份分类下拉。

### 为什么

- 分类是两层结构，普通下拉只会显示一条平铺列表，看不出父子关系；`CategorySelect` 把子分类缩进并加了连接图标，父级和子级都可以直接选中。
- 之前 `SignalDialog` 和 `IntakePage` 各自写了一份"拍平两层树、拼空格缩进"的逻辑（`buildSourceCategoryTree(...).flatMap(...)`），完全重复且用不安全的空白字符缩进（触发过 ESLint 的 `no-irregular-whitespace`）。统一之后这类树形展示逻辑只写一次。
- 分类树未来如果要接检索、图标展示、禁用态过滤，只需要改这一个组件。

### 用法

```tsx
// 必选字段（如登记待处理信息时的分类）
<CategorySelect
  categories={categories}
  value={form.categoryId}
  onChange={(categoryId) => setForm((current) => ({ ...current, categoryId }))}
  placeholder="请选择分类"
/>

// 带"全部"选项的筛选器
<CategorySelect
  categories={categories}
  value={categoryFilter === "all" ? null : categoryFilter}
  onChange={(value) => setCategoryFilter(value === null ? "all" : value)}
  allOptionLabel="全部分类"
/>
```

`categories` 直接传 `getSourceCategories(organizationId)` 返回的扁平数组，组件内部自己用 `buildSourceCategoryTree` 建树、渲染层级——调用方不需要，也不应该自己拍平或缩进。

不适用的场景：`SourceCategoryDialog` 里"选择上级分类"的下拉，因为规则是"只能选顶级分类"，本身没有层级可展示，继续用 `NativeSelect` 就行，不必强套 `CategorySelect`。

### 技术选型说明

shadcn/Base UI 里能表达层级下拉的候选有两个：

- **`Select`**（`ui/select.tsx`）：项目里已经在用（`StoryScopeSelect`、`chart-area-interactive.tsx`），API 简单可靠。`CategorySelect` 用它实现，父级和子级都是 `SelectItem`，子级加缩进和 `CornerDownRightIcon`。
- **`Combobox`**（`ui/combobox.tsx`）：支持搜索输入和 `ComboboxGroup`/`ComboboxLabel`，理论上更适合层级更深、条目更多的场景，但在这个仓库里还没有任何真实用例，API 面更大（`items`、过滤、chips 多选模式）。

当前分类树很浅（两层）、条目量也不大，选了风险更低、已有验证的 `Select`。如果后续分类数量涨到需要搜索的程度，再把 `CategorySelect` 内部实现换成 `Combobox`——因为外部 API（`categories`/`value`/`onChange`）已经和具体用哪个基础组件解耦，替换不影响调用方。

## `ui/select.tsx`（Base UI `Select`）踩坑：不传 `items` 就不会显示文本标签

`<Select>` 的 `<SelectValue>` **不会**自动去读取选中的 `<SelectItem>` 渲染出的内容当作显示文本——它默认只是把当前 `value` 原样字符串化显示出来。也就是说，如果只写：

```tsx
<Select value={categoryId} onValueChange={setCategoryId}>
  <SelectTrigger><SelectValue placeholder="选择分类" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="2">行业情报</SelectItem>
  </SelectContent>
</Select>
```

选中后触发器上显示的是字面量 `"2"`，不是"行业情报"。这是 Base UI 的既有设计（不是这个项目引入的 bug），`CategorySelect`、`StoryScopeSelect`、`chart-area-interactive.tsx` 里的时间范围下拉都踩过。

**规则：任何 `<Select>` 只要选项的显示文本和它的 `value` 不是同一个字符串，就必须给 `Select` 传 `items`**（`value → label` 的 map 或 `{value, label}[]` 数组），Base UI 会用它来解析 `<SelectValue>` 该显示什么：

```tsx
const itemLabels: Record<string, string> = { "2": "行业情报", "3": "趋势雷达" }

<Select items={itemLabels} value={categoryId} onValueChange={setCategoryId}>
  ...
</Select>
```

`items` 只影响 `<SelectValue>` 的文本解析，不影响下拉列表本身的渲染——`<SelectContent>`/`<SelectItem>` 还是要照常手写。
