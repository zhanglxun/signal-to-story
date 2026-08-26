# shadcn/ui 工程基座

## 已采用的官方方案

- 预设：Base Nova（Base UI），官方 preset code 为 `b0`
- 基础色：Neutral
- 字体：Inter Variable
- 图标：Lucide
- 默认圆角：`0.625rem`
- Block：控制台骨架基于 `dashboard-01`，登录页基于 `login-04`

官方入口：

- [Create 预设](https://ui.shadcn.com/create?preset=b0)
- [Blocks](https://ui.shadcn.com/blocks)
- [组件文档](https://ui.shadcn.com/docs/components)
- [主题文档](https://ui.shadcn.com/docs/theming)
- [CLI 文档](https://ui.shadcn.com/docs/cli)

## 本地源码策略

shadcn/ui 是源码分发模式，不是隐藏在依赖包中的黑盒组件库。全部官方组件源码保留在 `src/components/ui/`，方便后续页面和 Agent 直接查阅、组合及进行必要的本地适配。

当前源码通过以下官方 CLI 命令取得：

```bash
npx shadcn@latest add dashboard-01 login-04 --overwrite -y
npx shadcn@latest add --all --overwrite -y
```

如需查看官方 Block 源码而不写入文件：

```bash
npx shadcn@latest view dashboard-01 login-04 sidebar-07
```

## 视觉约束

1. 页面优先组合 `src/components/ui/` 中的官方组件，不重复开发 Button、Card、Sheet、Sidebar、Table 等基础控件。
2. 颜色只使用 `background`、`foreground`、`card`、`muted`、`primary`、`accent`、`destructive`、`border`、`ring` 等语义变量。
3. 主题选择器只提供 shadcn 官方常用色：Neutral、Red、Rose、Orange、Green、Blue、Yellow、Violet，并支持官方明暗模式与圆角调整。
4. 信息架构最多两级；当前一级入口为驾驶舱，二级业务入口集中在“内容生产”。
5. 产品 Logo 仍是占位标识，等待后续独立的品牌设计任务替换。

## 更新原则

更新前先运行 `npx shadcn@latest info` 核对预设和依赖，再按组件逐项更新。`--overwrite` 会覆盖本地适配，执行前必须先检查差异；更新后至少运行 typecheck、lint、单元测试、构建和浏览器回归。
