# sense-site

星火工厂 · Signal to Story 面向读者的内容站（工程目录名 `sense-site`，用户可见品牌见 `src/config/brand.ts`）。

- 产品范围：[PRD](../docs-site/design/sense-site-PRD.md) · 架构与权限：[SPEC](../docs-site/spec/sense-site-SPEC.md) · 计划：[建设计划](../docs-site/plan/sense-site-plan.md)
- 部署与 SPA 回退：[docs/deployment.md](docs/deployment.md)

## 运行

```bash
npm install
npm run dev:demo        # 本地演示：内置示例快照，页面顶部显示“演示数据”
npm run dev             # 配置 .env.local 后连接 Supabase（只用 URL + publishable key）
npm run typecheck && npm run lint && npm run test && npm run build
```

未配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` 时自动进入演示模式；配置后数据库出错只显示重试，不会回退到演示数据。配置了后端的构建产物中不包含演示数据（构建期常量折叠）。

## 结构

```text
src/
├── app/               路由与 Provider
├── components/ui/     从 sense-console 复制的 shadcn（Base UI）组件
├── components/site/   站点自有组件：布局、卡片、阅读、状态
├── config/brand.ts    品牌文案唯一来源
├── contracts/site.ts  读者侧契约（与数据库公开列集合一致）
├── data/              演示模式示例快照
├── features/          读者登录、主题、React Query hooks
├── lib/               env、Supabase 客户端、markdown-it（html:false）
├── pages/             首页、探索、内容、专题、资源库、我的、登录/注册/找回密码、404
├── services/          SiteService 接口及 Supabase / demo 两种实现；读者 Auth
└── test/              vitest；test/db 为 PGlite 权限隔离测试
```

数据库迁移不在本目录：站点发布层位于 `sense-console/supabase/migrations/20261116100000_create_site_publishing.sql` 与 `20261116100100_site_publish_functions.sql`，SQL 验收脚本为 `sense-console/supabase/tests/site_publishing.sql`。

`src/test/db/` 使用 PGlite 在进程内应用 sense-console 的全部迁移，并以 anon / 注册读者 / 后台成员身份真实执行 RLS 与 GRANT；不连接任何远程数据库。

## 组件与主题基线

`src/components/ui/{alert,badge,button,card,input,label,separator,sheet,skeleton}.tsx`、`src/lib/utils.ts`、`src/index.css` 的 token 部分、`components.json` 复制自 sense-console，基线提交 `db13ebf`。站点改动：sheet 关闭按钮文案改为中文；字体回退加入 Noto Sans SC；index.css 末尾追加站点阅读排版 `.site-prose`。依赖版本按 sense-console lockfile 的解析版本固定，markdown-it 与 PGlite 为本站新增。
