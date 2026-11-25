# 导航配置

`navigation.json` 是 Console 菜单的唯一数据源。

- `modules` 对应最左侧 AppRail 一级模块。
- `modules[].groups` 是 AppSider 内不占路由、不可点击的展示分组。
- `modules[].groups[].items` 对应当前模块 AppSider 页面入口。
- 分组只用于归类，不可折叠，也不计为可导航菜单层级；不要增加 `children`。
- `defaultPath` 是点击一级模块后进入的默认页面，必须指向该模块已有的二级菜单路径。
- `auxiliaryRoutes` 用于账号信息、详情或编辑等不显示在菜单里的页面，只声明它归属哪个一级模块。

当前支持的图标名称：`Workflow`、`Settings`、`Gauge`、`Clapperboard`、`Users`、`Settings2`、`LayoutDashboard`、`Sparkles`、`ListTodo`、`Library`、`Building2`、`ShieldCheck`、`SlidersHorizontal`。未知图标会回退为圆点。

JSON 只负责导航展示与选中状态。新增全新页面时，还需要在 `src/App.tsx` 注册对应 React Router 路由。
