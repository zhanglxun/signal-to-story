# 前端约定

> 由旧 `frontend-conventions.md` 和 `shadcn-foundation.md` 合并而来。适用于 sense-console 和 sense-site。

## 1. 技术基座

React 19、TypeScript strict、Vite、React Router 7、Tailwind CSS 4、TanStack Query、shadcn/ui（Base UI，Nova 预设 `b0`，Neutral 基础色，Inter 字体，Lucide 图标，圆角 `0.625rem`）。Console 的骨架基于 `dashboard-01`，登录页基于 `login-04`。

## 2. 规则

1. 只用一套组件库。基础控件全部来自 `src/components/ui/`（shadcn 源码分发），不要重复造 Button、Card、Sheet、Table。
2. 颜色只用语义变量（background、foreground、card、muted、primary、accent、destructive、border、ring），页面里不散写品牌色或状态色。
3. 导航最多两级。
4. 页面保持精简；数据访问放在 service 层。0.5 起按模块放在 `src/modules/<域>/services`。
5. **同一种交互全项目只有一个实现**，已有共享组件就必须复用。清单：
   - 分类层级下拉一律使用 `CategorySelect`（`components/source-categories/category-select.tsx`）。直接传扁平的分类数组即可，由组件自己建树和缩进。唯一的例外是「选择上级分类」，因为只能选顶级分类，用 `NativeSelect` 就够了。
6. 更新 shadcn 组件前先运行 `npx shadcn@latest info`，逐个组件更新；`--overwrite` 会覆盖本地改动，执行前先看差异。

## 3. 已知的坑：Base UI `Select` 必须传 `items`

`<SelectValue>` 默认只把 value 原样显示出来。只要选项的显示文本和 value 不是同一个字符串，就必须给 `<Select>` 传 `items`（`value → label` 的映射或 `{value, label}[]`），否则选中后会显示 `"2"` 而不是「行业情报」。`items` 只影响触发器上显示的文本，`<SelectItem>` 仍然要照常写。
