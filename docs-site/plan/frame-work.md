# Signal to Story Console 框架搭建计划

## 0. 文档目的与当前决策

在 `signal-to-story/sense-console/` 中搭建一套可复用的 React 内容运营后台基座，产品展示名统一为 **Signal to Story**。

源工程仅作为通用工程能力和交互模式的参考：

```text
/Users/jarvis/project/prototype/funde/funde-console/prototype
```

目标工程固定为：

```text
/Users/jarvis/project/agent/signal-to-story/sense-console
```

本次迁移只吸收源工程的工程配置、设计系统思路、基础组件、后台布局和页面模式，不迁移富德健康相关的业务代码、菜单、数据、Logo、角色名称、路由、localStorage Key 或企业级平台特有能力。

已确认的架构决策：

1. 前端、Supabase 本地配置、数据库 migration 和 Edge Functions 均放在 `sense-console/` 下。
2. 普通认证、CRUD、Realtime 和 Storage 由浏览器通过 Supabase SDK 直接访问，不单独开发传统后台 API 服务。
3. 数据安全由 Supabase Auth、表暴露权限和 RLS 共同保证，不能依赖前端菜单或路由守卫。
4. 只有需要服务端 Secret、强校验、Webhook、Agent Gateway 或跨多表可信事务的能力，才使用 Supabase Edge Functions 或数据库函数。
5. 数据库业务表结构由独立设计文档定义，本计划不提前设计完整领域模型。
6. 框架阶段不建设通用 AI Agent 平台，不实现长时间运行的媒体 Worker。
7. shadcn/ui 使用执行时的最新 CLI，并采用其当前默认的 **Base UI** 基座，不再指定 Radix UI。
8. 桌面端采用源工程的 `AppRail + AppSider + AppHeader` 双栏框架，但菜单严格压缩为两层，不复刻三级菜单和多标签工作台。

---

## 1. 工程边界与目录

### 1.1 本阶段目录

```text
signal-to-story/
├── sense-console/
│   ├── src/
│   │   ├── app/                 # 应用启动、Provider、路由和全局配置
│   │   ├── components/
│   │   │   ├── ui/              # shadcn/ui 生成的基础组件
│   │   │   ├── shared/          # 跨页面组合组件
│   │   │   └── layout/          # AppShell、Header、Sidebar、Breadcrumb
│   │   ├── config/              # 品牌、菜单和运行配置
│   │   ├── contracts/           # 前端当前使用的类型和 Schema
│   │   ├── features/            # Auth、Theme 等跨页面能力
│   │   ├── hooks/
│   │   ├── lib/                 # Supabase Client、Query Client、工具函数
│   │   ├── routes/
│   │   ├── services/            # 面向业务的 Supabase 查询封装
│   │   └── views/               # 页面
│   ├── supabase/
│   │   ├── config.toml          # Supabase 本地开发配置
│   │   ├── migrations/          # 可部署、可审计的数据库变更
│   │   ├── functions/           # 必要的 Edge Functions；不承载普通 CRUD
│   │   └── seed.sql             # 仅本地开发和测试数据
│   ├── docs/
│   │   └── supabase-data-model.md # 独立数据库表结构设计文档，由后续设计任务维护
│   ├── .env.example
│   ├── components.json
│   ├── package.json
│   └── package-lock.json
└── docs-site/
```

### 1.2 `supabase/` 的目的

`supabase/` 不是一个独立后台服务，而是 Supabase 项目配置和数据库变更的代码化记录，用于：

- 本地启动与测试 Supabase。
- 保存数据库 migration、RLS、Storage Policy 和必要的数据库函数。
- 保存少量需要服务端运行的 Edge Functions。
- 让开发、测试和生产环境的数据库结构可重复部署。

数据库表的产品设计先写入独立的 `docs/supabase-data-model.md`；设计确认后，再通过 migration 落地。设计文档用于解释模型，migration 才是实际部署的结构真相。

### 1.3 为什么普通访问不需要后台 API

以下能力直接使用 `@supabase/supabase-js`：

- 邮箱和密码登录、登出、会话恢复。
- 受 RLS 保护的表查询与增删改。
- 私有 Storage 的授权上传、下载或签名 URL。
- 后续确有需要时的 Realtime 订阅。

以下能力不能直接放在浏览器中，应放入 Edge Function、数据库函数或后续 Worker：

- 使用 `service_role`、Provider API Key 等服务端 Secret。
- Agent Gateway 的上下文读取、Schema 校验和 Proposal 提交。
- 第三方 Webhook 与签名验证。
- 需要绕过普通用户权限的管理操作。
- 长时间 AI、转写、视频生成、下载、FFmpeg 或 Remotion 任务。

### 1.4 Worker 与 packages 的后续定位

本阶段不创建 Worker，也不创建 `packages/`。

Worker 是未来独立运行、独立部署的后台进程，用来执行浏览器和 Edge Function 不适合承担的长任务，例如：

- 图像、视频、TTS 或转写任务轮询。
- Provider 临时文件下载和 Supabase Storage 入库。
- FFmpeg/Remotion 渲染。
- 队列消费、有限重试、成本记录和失败恢复。

未来确有需要时，可在 `sense-console/workers/media/` 中建立独立运行入口。它与 Web Console 位于同一工程目录，但具有独立的依赖、进程和部署生命周期。

`packages/` 只在 Web、Worker、CLI 需要共享同一套契约时再引入，例如将 `src/contracts/` 提升为 `packages/contracts/`。当前只有 Web 使用这些类型，不提前建立 Monorepo 抽象。

---

## 2. 技术栈

核心技术栈：

- React 19
- TypeScript 5.9，开启 strict
- Vite 7
- React Router 7
- Tailwind CSS 4
- shadcn/ui 最新 CLI
- Base UI
- Lucide React
- class-variance-authority
- clsx
- tailwind-merge
- tw-animate-css
- `@supabase/supabase-js`
- TanStack Query，用于服务端状态、分页、Mutation 和缓存失效
- Inter Variable Font
- 中文系统字体回退：Noto Sans SC、PingFang SC、Microsoft YaHei、sans-serif

按已出现的真实页面需求再加入：

- `markdown-it`：Markdown 只读预览，默认禁用原始 HTML。
- `date-fns`、`react-day-picker`：出现日期选择需求时加入。
- `exceljs`：出现真实 Excel 导入或导出需求时加入，并采用懒加载。

约束：

- 不改为 Vue、Pinia、Vue Router 或 shadcn-vue。
- 不引入第二套 UI 组件库。
- 不因为“未来可能需要”预装依赖。
- 首次初始化可以使用 `shadcn@latest`；生成结果、依赖版本和 lockfile 必须提交，保证后续构建可复现。
- 采用 Base UI 后，不从源工程复制依赖 Radix 私有行为的组件实现。

推荐初始化方式：

```bash
npx shadcn@latest init --template vite --base base
```

执行前先通过 `npx shadcn@latest --help` 核对当前 CLI 参数，不凭旧版本经验猜测命令。

---

## 3. 迁移原则

1. 先检查 `sense-console/` 的 package.json、src、路由、样式、组件和未提交修改；目录不存在时再初始化。
2. 不覆盖目标工程已有业务代码，不修改与本次基座无关的文件。
3. 只迁移通用模式，不直接复制源工程组件目录。
4. 基础组件优先通过最新 shadcn CLI 重新生成，再按目标设计系统做最小调整。
5. 如果目标工程已有同类能力，优先合并，不建立平行体系。
6. 所有修改必须通过 TypeScript strict。
7. 每个新增文件都必须能对应到当前验收场景。
8. 不复制源工程依赖 Radix 的实现细节、业务判断或样式补丁。
9. 不复制任何 `funde`、富德健康、供应链、呼叫中心或原平台角色语义。

---

## 4. 工程配置

参考源工程但不机械覆盖：

- package.json
- components.json
- vite.config.ts
- tsconfig.app.json
- eslint.config.js
- src/index.css
- src/lib/utils.ts

要求：

- 配置 `@/*` 指向 `src/*`。
- 接入 Tailwind CSS 4 和 shadcn/ui CSS。
- `components.json` 明确 Base UI、Lucide、CSS Variables 和目标路径别名。
- 配置 `dev`、`typecheck`、`lint`、`test`、`test:e2e`、`build`、`format` 和 `preview` 命令。
- 使用 ESLint、Prettier 和 Tailwind 排序插件。
- 保留目标项目已经存在且仍被使用的依赖。
- 提交 lockfile；Supabase 和其他运行时依赖不得只使用不可复现的临时安装结果。
- `.env.example` 只列变量名，不包含真实值。

浏览器允许使用的变量：

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

禁止出现在 `VITE_*`、前端源码、Markdown 或浏览器包中的变量：

```text
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEY
DATABASE_URL
AI_PROVIDER_API_KEY
```

部署平台必须配置 SPA fallback，确保直接访问详情路由时仍返回 `index.html`。

---

## 5. 品牌与设计系统

### 5.1 品牌配置

建立集中式 `brand.config.ts`，第一版使用：

```ts
export const brandConfig = {
  productName: "Signal to Story",
  shortName: "Signal to Story",
  companyName: "susesne.cn",
  domain: "susesne.cn",
  browserTitle: "Signal to Story",
  copyrightText: `© ${new Date().getFullYear()} susesne.cn`,
  logo: null,
} as const
```

Logo 任务保留，当前只提供不冒充正式 Logo 的文字占位和替换接口：

- [ ] 使用 Logo 生成 Skill 创建 Signal to Story Logo。
- [ ] 补充浅色、深色、方形图标和 favicon 版本。
- [ ] 更新 `brand.config.ts`、登录页、Header 和 favicon。

不得在组件中散写产品名、公司名、域名或版权文案。

### 5.2 设计 Token

从源工程参考 Token 的语义结构，不直接复制富德品牌颜色。使用 Tailwind CSS 4 和 shadcn/ui 当前的 OKLCH CSS Variables。

必须包含：

- primary、secondary、muted、accent
- destructive
- success、warning、info
- background、foreground、card、popover
- border、input、ring
- sidebar 系列 Token
- chart 系列 Token
- radius 系列 Token
- 浅色和深色主题

`destructive` 是组件破坏性动作的标准语义。若业务状态需要 `danger`，令其映射到相同底层色阶，不建立第二套红色体系。

禁止在业务页面中散写裸 HEX、RGB 或任意状态色。品牌色、状态色和组件颜色必须通过语义 Token 使用。

### 5.3 字体

英文、数字和指标优先使用 Inter Variable；中文按以下顺序回退：

```css
font-family: "Inter Variable", "Noto Sans SC", "PingFang SC",
  "Microsoft YaHei", sans-serif;
```

本阶段不为了中文字体打包大型 Web Font；需要严格品牌字体时再单独评估体积和加载策略。

---

## 6. 基础组件与共享组件

### 6.1 第一阶段生成的基础组件

建立 `src/components/ui/`，只生成当前页面实际使用的组件：

- button
- input
- label
- badge
- card
- table
- dialog
- sheet
- dropdown-menu
- tooltip
- separator
- skeleton
- alert
- sidebar
- breadcrumb
- sonner

需要时再添加：

- textarea
- select
- checkbox
- radio-group
- switch
- popover
- calendar
- pagination
- scroll-area

`single-date-picker`、`date-range-picker`、`form-inline-field` 属于组合组件，不作为官方原子组件处理，等真实表单出现后再设计。

组件要求：

- Variant 需要复用时使用 class-variance-authority。
- 使用 `cn()` 合并 className。
- 不包含具体业务语义。
- 图标统一使用 lucide-react。
- 保留键盘焦点、Label、aria 属性和必要无障碍语义。
- 不手工维护第二套 Button、Table、Pagination、Dialog 或通知系统。

### 6.2 第一阶段共享组件

建立 `src/components/shared/`，第一阶段只提供：

- `ListPageLayout`：标题、筛选区、表格内容和分页槽位。
- `FilterPanel`：统一筛选区布局。
- `PaginationBar`：统一分页交互。
- `DetailPageLayout`：标题、内容区和操作区。
- `DetailSection`：详情分区。
- `StatusBadge`：只接受语义状态映射。
- `EmptyState`。
- `ErrorState`。
- `PageLoadingState`。
- `notify`：对 Sonner 的薄封装。

暂不迁移整套 `Workbench*` 组件，也不建立树形侧栏页面、标签页 Header 或复杂固定底栏弹窗。长表单弹窗真实出现时，再抽取统一的可滚动内容区和固定操作区。

---

## 7. AppShell 与菜单

建立轻量 AppShell，包含：

- 顶部 AppHeader：二级菜单折叠按钮、搜索占位、主题切换、外观设置和右上角用户菜单。
- 左侧 AppRail：固定展示一级业务模块。
- 当前模块 AppSider：按 JSON 中的非点击式分组展示二级页面入口，并保留平滑收起动画。
- 主内容滚动区和合理最大宽度。
- 移动端使用一个 Sheet 合并展示两级菜单。
- 窄屏下表格使用容器滚动或响应式字段降级，页面不得整体横向溢出。

本阶段不做：

- 顶部导航与侧边导航自由切换。
- 三级及以上菜单。
- 多标签页工作台。
- 复杂设置抽屉。
- 源工程中的供应链、呼叫中心或特殊路由判断。

菜单最多两层：一级模块只存在于 AppRail，二级页面只存在于 AppSider。AppSider 允许使用不可点击、不可折叠的展示分组归类页面；展示分组不占路由，也不构成第三级菜单。

菜单保存在 `src/config/navigation.json`，使用 `modules[].groups[].items` 结构，产品维护者可直接修改 JSON 扩展。图标名称、类型和路由归属由同目录 TypeScript 适配层处理，不引入数据库菜单、远程菜单或动态组件注册系统。

外观设置提供 `彩色 / 浅色` 两种 AppRail 配色并在浏览器本地保存；布局结构不隐式决定侧栏颜色。当前只实现侧边布局，不提供顶部布局切换。

### 7.1 当前最简模块规划

当前菜单保持两层：

1. **生产控制**：驾驶舱、选题、任务中心、资产库；故事、脚本和分镜在数据模型确认后逐步加入，不先建空菜单。
2. **系统管理**：
   - `组织与账号`：组织资料、后台账号列表和创建账号。
   - `角色管理`：从 Supabase 展示组织角色、能力集合和分配状态。
   - `系统设置`：运行环境和外部连接状态。

`账号信息` 是右上角用户菜单的辅助路由，不作为 AppSider 菜单项；访问该页面时，AppRail 仍归属系统管理模块。

不复制参考平台的用户账号/平台账号双池、机构树、区域/渠道、菜单管理、资源权限树和自定义角色中心。个人平台出现真实多人协作需求前，不建设复杂 RBAC。

---

## 8. Supabase Auth、路由与权限

### 8.1 登录方式

V1 采用 Supabase 原生的 **邮箱 + 密码** 登录：

```ts
await supabase.auth.signInWithPassword({ email, password })
```

“账号”在 V1 中就是邮箱地址，不自行实现用户名到邮箱的映射服务。

后台默认不开放公众自助注册。用户可先由 Supabase Dashboard 或后续管理员能力创建/邀请。登录页包含：

- 邮箱输入。
- 密码输入与显示/隐藏。
- 提交中、错误和限流提示。
- 忘记密码入口；生产启用前配置 Redirect URL 和自有 SMTP。
- 不使用“用户不存在”等可用于账号枚举的差异化文案。

当前管理员能力采用 `admin-create-account` Edge Function：具备 `account.manage` 权限的组织角色可在后台填写邮箱、显示名称、临时密码和目标角色；函数根据 `organization_roles` 中的分配规则校验权限，再在服务端调用 Supabase Auth Admin API 并直接确认邮箱。浏览器不得调用 Admin API，也不得持有 secret/service-role 密钥。

### 8.2 Supabase Client 与会话

- 使用单例 `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)`。
- 应用启动时恢复会话并校验当前 JWT claims，再决定进入后台或登录页。
- 订阅 `onAuthStateChange`，统一处理登录、登出、Token 刷新和密码恢复事件。
- 未完成首次会话判断时显示启动加载态，避免受保护页面闪烁。
- 登出调用 Supabase Auth 的 `signOut()`，并清理 TanStack Query 中的用户缓存。
- 不自建 access token、refresh token 或角色权限的 localStorage 副本。
- 前端 RequireAuth 只负责导航体验，数据库 RLS 才是数据授权边界。

### 8.3 路由

采用 React Router 7 的 `createBrowserRouter`，实现：

- `/login`
- `/forgot-password`
- `/update-password`
- RequireAuth 登录守卫
- AppShell 嵌套路由
- 菜单树驱动导航
- 默认首页
- 内容列表示例页
- 内容详情示例页
- `/forbidden`
- `*` 404 页面
- 路由级 lazy loading 和统一错误边界

### 8.4 权限模型边界

前端保留通用展示接口：

```ts
type PermissionCode = string

interface AppUser {
  id: string
  email: string
  displayName?: string
  roles: string[]
  permissions: PermissionCode[]
}
```

菜单项支持：

```ts
interface MenuItem {
  id: string
  label: string
  path?: string
  icon?: React.ComponentType
  children?: MenuItem[]
  requiredPermissions?: PermissionCode[]
}
```

约束：

- 菜单过滤和无权限页面只提供 UI 体验，不能代替 RLS。
- 不根据用户可修改的 `user_metadata` 做授权。
- 后续角色和工作区关系优先存放在独立成员表；确需 JWT 授权声明时使用受控的 `app_metadata`，并考虑 Token 刷新延迟。
- 不能仅使用 `TO authenticated` 作为业务表授权；RLS 还必须校验 owner 或 workspace membership。
- UPDATE Policy 必须同时考虑 SELECT、USING 和 WITH CHECK。

### 8.5 当前角色模型

- `owner`：组织和账号最终控制权，可创建 Owner/Admin/Member/Viewer。
- `admin`：可创建 Admin/Member/Viewer 并管理内容生产，不可授予 Owner。
- `member`：可创建和维护内容、任务与资产，不管理账号。
- `viewer`：只读查看驾驶舱、状态和资产关系。

四个角色是 `organization_roles` 的默认种子数据，不是前端硬编码常量。角色定义、能力集合、是否可分配和分配所需权限均由数据库维护，成员关系通过外键引用角色。V1 先提供数据库驱动的角色列表，不开放自定义角色、菜单权限树或按钮级权限编辑；前端展示权限不替代 RLS 和 Edge Function 的服务端校验。

---

## 9. Supabase 数据与接口计划

### 9.1 独立数据模型文档

完整业务表由单独的 `sense-console/docs/supabase-data-model.md` 定义，至少说明：

- 表、字段、主键、外键和唯一约束。
- workspace/owner 数据隔离方式。
- 状态枚举和状态迁移规则。
- RLS Policy 矩阵。
- Data API 暴露范围和 GRANT。
- Storage Bucket 与 Policy。
- 索引、全文检索和后续向量检索需求。
- 审计、软删除、幂等键和时间字段约定。
- Agent Run、Proposal 和 Context Pack 的边界。

本框架任务只建立文档位置、Supabase 目录、环境变量、Client、Auth 和数据访问层骨架，不替用户提前确定完整业务表结构。

### 9.2 直接使用 Supabase API 的规则

普通页面通过 `src/services/` 调用 Supabase SDK，不在 React 页面中散写复杂查询。每个 service：

- 接收明确的查询参数。
- 返回稳定的应用类型。
- 统一处理 Supabase Error 到应用错误的转换。
- 支持分页、排序、筛选和 AbortSignal（SDK 支持时）。
- 不包含 `service_role` 或绕过 RLS 的逻辑。

必须同时配置：

1. 表是否暴露给 Data API，以及 anon/authenticated 的显式 GRANT。
2. 每张暴露表的 RLS。
3. 与真实 owner/workspace 关系一致的 Policy。

“表可访问”和“允许访问哪些行”是两层配置，缺一不可。

### 9.3 Agent 与 Edge Functions 使用边界

框架阶段只建立目录、契约和安全约定，不实现可运行的通用 Agent 或完整 Agent Gateway：

- 在 `src/contracts/` 预留版本化的 Context Pack、Agent Run 和 Proposal 类型位置。
- 约定 Agent 输出必须包含 `schema_version`、`task_type`、`source_ids`、`confidence` 和 `assumptions`。
- 约定所有写入带幂等键，并记录调用者、输入引用、Prompt/模型版本、时间、状态和审核结果。
- 约定 Agent 只能提交 Proposal 或 Draft，不能批准、发布、删除或直接改写正式对象。
- 在独立数据模型文档中定义 `agent_runs` 与 `agent_proposals` 的职责边界，具体字段随后确认。
- 为未来 Edge Functions 保留目录和 README，说明 Context Pack、Proposal、Webhook 和 Provider Secret 的服务端边界。

数据模型确认后，确有真实调用需求时再实现对应 Edge Function。Edge Functions 不承载普通列表、详情和编辑 CRUD，也不执行长时间媒体任务。

---

## 10. 前端数据、Markdown 与错误处理

### 10.1 TanStack Query

统一使用 TanStack Query 管理服务端状态：

- Query Key 集中定义。
- 列表筛选和分页参数进入 Query Key。
- Mutation 成功后只失效相关缓存。
- Auth 用户变化时清理上一用户缓存。
- 页面区分首次加载、后台刷新、空数据和错误状态。

### 10.2 Markdown 安全

需要预览 Obsidian 快照时使用 `markdown-it`：

- 默认设置 `html: false`，不执行 Markdown 中的原始 HTML。
- 外链增加安全的 `rel` 属性。
- 不支持任意 iframe、script 或事件属性。
- 如果未来必须支持 HTML，再引入明确的 HTML Sanitizer 和白名单，不自行用正则清洗。

### 10.3 通知和错误

- 使用 Sonner，不迁移旧 shadcn Toast。
- 页面级错误使用 `ErrorState`，操作反馈使用 `notify`。
- 用户文案不直接展示数据库、SQL、Token 或 Provider 原始错误。
- 开发环境保留可诊断日志，生产环境接入监控后再统一上报。

---

## 11. 页面目录规范

页面目录按实际复杂度组织，不强制每个页面创建空文件：

```text
src/views/<module>/<page>/
├── page.tsx
├── schema.ts       # 页面确有 Schema 时创建
├── mock.ts         # 仅演示或测试需要时创建
├── queries.ts      # 页面查询复杂时创建
└── index.ts
```

要求：

- Mock 数据不得大段内联在 `page.tsx`。
- 正式业务页面不得回退到 Mock 权限或 Mock 登录。
- 跨页面查询放在 `src/services/`，只属于一个页面的组合逻辑可以就近放置。
- 共享类型优先放 `src/contracts/`，不要在多个页面重复声明。

---

## 12. 框架阶段演示页面

为验证基座，创建三个中性但贴合产品的页面：

1. 登录页
   - Signal to Story 文字品牌占位。
   - Supabase 邮箱 + 密码真实登录。
   - 登录失败、加载和忘记密码入口。
2. 内容列表示例页
   - 搜索筛选。
   - 状态筛选。
   - 表格。
   - StatusBadge。
   - 分页。
   - Loading、Empty 和 Error State。
3. 内容详情示例页
   - 基础信息。
   - 两个详情分区。
   - 返回、编辑按钮。

在业务数据库模型尚未确认前，列表和详情数据使用页面目录下的中性 Mock，例如“示例选题”“示例内容项目”；Supabase Auth 必须是真实接入。业务表设计完成后，再将 Mock 替换为受 RLS 保护的 Supabase 查询。

---

## 13. 测试与验收

### 13.1 必须执行的命令

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

具备可运行测试环境后执行：

```bash
npm run test:e2e
```

### 13.2 功能验收

- Supabase 邮箱 + 密码登录成功后进入后台。
- 未登录访问受保护路由会跳转登录页，并能在登录后返回原目标页。
- 登出后受保护数据缓存被清理。
- 菜单、面包屑和路由联动正常。
- 菜单不超过两层。
- 列表和详情页正常显示 Loading、Empty、Error 和正常数据状态。
- 深浅主题可以切换并持久化用户偏好。
- 页面无整体横向异常溢出。
- 桌面和移动窄屏下导航可用。
- 404 和无权限页面可达。
- 浏览器包中不存在 `service_role`、数据库密码或 Provider Key。
- 没有同时存在两套 Button、Table、Pagination、Dialog 或 Toast。
- Markdown 预览不执行原始 HTML 或脚本。

### 13.3 品牌与迁移清理验收

全工程扫描并确认不存在：

- `funde`
- `富德`
- `富德健康`
- `sense-console` 作为用户可见产品名
- 供应链、呼叫中心等源业务名称
- 源工程 Logo、角色和业务路由
- 源工程 localStorage Key

允许 `sense-console` 仅作为工程目录名或 package 技术标识存在。浏览器标题、登录页、Header 和用户可见文案统一使用 `Signal to Story`。

Logo 在正式发布前完成，框架阶段保留以下未完成任务：

- [ ] 使用 Logo 生成 Skill 创建正式品牌资产。
- [ ] 替换文字占位、favicon 和主题版本。

### 13.4 Supabase 安全验收

- 前端仅使用 Project URL 和 publishable key。
- 所有暴露业务表开启 RLS。
- Data API 暴露和 GRANT 被显式记录，不依赖默认行为。
- RLS 不是只有 `TO authenticated`，而是绑定真实 owner/workspace 关系。
- 角色授权不读取 `user_metadata`。
- View 如需暴露，使用 `security_invoker = true` 或放在非暴露 Schema。
- Storage 使用私有 Bucket 和对应 Policy。
- migration、RLS 和 Storage Policy 有本地或 CI 验证。

---

## 14. 分阶段实施

### Phase 1：工程与品牌基座

- 初始化 `sense-console/`。
- 配置 React、Vite、TypeScript、Tailwind 4、shadcn/ui Base UI。
- 建立设计 Token、主题、字体和品牌配置。
- 使用 `Signal to Story` 和 `susesne.cn`。
- 保留 Logo 待办。

### Phase 2：Supabase Auth 与应用壳

- 建立 Supabase Client、环境变量和本地目录。
- 接入邮箱 + 密码登录、会话恢复、登出和密码恢复路由。
- 建立 RequireAuth、AppShell、两层以内菜单、面包屑和响应式导航。
- 明确 Data API、RLS 和 Edge Function 使用边界。

### Phase 3：页面模式验证

- 生成实际需要的 shadcn/ui 组件。
- 建立精简共享页面组件。
- 完成列表、详情、404 和无权限页面。
- 接入 TanStack Query、错误处理和 Sonner。
- 完成单元测试、路由测试和基本 E2E。

### Phase 4：数据模型确认后接入持久化

- 单独完成 `docs/supabase-data-model.md`。
- 根据确认的数据模型生成 migration、RLS、GRANT、Storage Policy 和类型。
- 将列表和详情 Mock 替换为 `src/services/` 中的 Supabase 查询。
- 通过数据库与 RLS 测试后再进入真实业务页面开发。

### Phase 5：受控 Agent 契约骨架

框架阶段只完成以下约定，不接入模型、不实现 Agent 执行或调度：

- 定义版本化的 Context Pack、Agent Run 和 Proposal Schema 位置与最小公共字段。
- 定义幂等、来源引用、Prompt/模型版本、状态、成本和人工审核记录要求。
- 明确 Agent 只能读取最小上下文并提交 Proposal。
- 明确 Agent 不得直接使用数据库高权限密钥、批准、发布或删除正式内容。
- 为未来 Edge Function 留出目录、调用约定和安全说明，待数据模型确认后再实现端点。
- 不建设长任务 Worker；媒体 Worker 在后续独立阶段评估。

---

## 15. 本阶段明确不做

- 不开发独立 Node/Java/Spring 后台 API 服务。
- 不一次性实现完整内容业务数据库模型。
- 不建设通用 Agent 编排平台。
- 不创建 Media Worker。
- 不实现自动媒体生成或自动发布。
- 不实现三级菜单、多标签工作台、顶部/侧边布局切换或复杂设置抽屉。
- 不一次性迁移所有源工程组件。
- 不实现复杂日期范围、Excel 导出或树形侧栏页面。
- 不创建第二套 UI、通知、分页或弹窗体系。
- 不反向写入 Obsidian Vault。

---

## 16. 完成后输出

实施完成后必须提供：

1. 新增和修改的文件清单。
2. 迁移或重新生成的通用能力清单。
3. 因业务相关、技术基座变化或当前阶段不需要而未迁移的源工程能力。
4. typecheck、lint、test、build 和 E2E 的执行结果。
5. Supabase Auth、环境变量、Data API 和 RLS 的配置说明。
6. 后续添加新列表页和详情页的最小示例。
7. 当前未完成任务，包括 Logo 和独立数据库模型设计。
