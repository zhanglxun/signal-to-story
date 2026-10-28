# sense-site

Signal to Story 的读者站。工程名是 `sense-site`，页面上的产品名是 Signal to Story。

这是 P1 可运行基线：独立的 Vite + React + TypeScript 单页应用，带首页、探索、正文、专题、资源库和个人入口。内容来自 `src/services/` 里的占位目录，用来核对路由和版面，不是已发布快照。数据库迁移仍只放在 `sense-console/supabase`。

- [产品页面与首版范围](../docs-site/design/sense-site-PRD.md)
- [架构、数据与权限方案](../docs-site/spec/sense-site-SPEC.md)
- [分阶段建设与验收计划](../docs-site/plan/sense-site-plan.md)
- [复制的主题和组件基线](docs/ui-baseline.md)

## 本地运行

```bash
cd sense-site
npm install
npm run dev
```

常用检查：

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run preview
```

`npm run build` 会先做类型检查，再把生产包输出到 `sense-site/dist/`，入口是 `dist/index.html`。

没有 Supabase 环境变量也可以开发和构建。需要预留连接时，复制 `.env.example` 为 `.env.local`，只填写项目 URL 和 anon / publishable key。不要写入 `service_role`、`sb_secret` 或数据库密码；浏览器里遇到这类密钥会直接忽略。当前即使填了 URL，目录数据仍走占位服务，账号登录才会使用 Supabase Auth。

## 路由

| 路径 | 页面 |
| --- | --- |
| `/` | 首页：精选、最新、专题 |
| `/explore` | 探索。分类、形式、栏目、搜索和游标写在查询字符串里 |
| `/content/:slug` | 正文、目录、来源、收藏 |
| `/topics`、`/topics/:slug` | 专题列表和有序篇目 |
| `/resources` | 资源说明、权限和失效状态 |
| `/me` | 登录后的收藏 |
| `/login`、`/register`、`/forgot-password` | 辅助账号页，不进主导航 |

未知地址显示 404。`/explore?category=lab` 是一个没有内容的分类。`/content/status-error` 用来看请求失败和重试。未登录打开 `/content/model-limits` 只能看到摘要。

主导航只有一层：首页、探索、专题、资源库、我的。正文和专题详情高亮各自的上级，不做成第三级菜单。

## 静态部署

把 `dist/` 目录作为站点根目录。主机必须把未知路径回退到 `index.html`，否则直接打开 `/content/...` 会 404。

构建会额外写出：

- `dist/404.html`：和 `index.html` 相同，给用 404 页面做回退的主机
- `dist/_redirects`：`/* /index.html 200`，给 Netlify、Cloudflare Pages 这一类
- `dist/vercel.json`、`dist/serve.json`：给 Vercel 和 `serve` 的 SPA 重写

`npm run preview` 自带单页回退，可先本地打开详情地址确认。

部署到 [here.now](https://here.now/docs) 时发布 `dist/`，并打开 SPA 模式，这样未知路径会返回 `index.html`：

```bash
cd sense-site
npm run build
npx --yes skills add heredotnow/skill --skill here-now -g
# 在 here-now skill 的 scripts 目录下：
./scripts/publish.sh /绝对路径/sense-site/dist --spa
```

这里不预设生产域名。站点 origin 需要和控制台分开。注册邮件里的回跳地址也要单独加入 Supabase 的允许列表。占位基线的 `index.html` 带了 `noindex`，接入真实发布内容后再去掉。

正式正文、注册可读快照和个人收藏不能打进这个静态包。占位服务里的注册正文只是一句版式说明。
