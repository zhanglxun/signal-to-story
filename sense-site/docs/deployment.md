# sense-site 部署说明

尚未部署；以下为部署时需要完成的配置。

## 构建

```bash
npm ci && npm run build   # 产物：dist/
```

构建期环境变量（只允许浏览器安全值）：

| 变量 | 说明 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable key；禁止 service_role / secret key |
| `VITE_SITE_NAME` / `VITE_SITE_DESCRIPTION` | 站点标题与简介（可选） |
| `VITE_SITE_ORGANIZATION_ID` | 可选：只显示该组织已发布的稿件 |
| `VITE_SITE_DEMO` | 仅本地演示时设为 `1`；生产必须为空 |

## SPA 回退

所有未命中静态文件的路径都要返回 `index.html`（HTTP 200），否则直接打开 `/content/:slug` 会 404。

- Netlify / Cloudflare Pages：已提供 `public/_redirects`（`/* /index.html 200`）。
- Nginx：`location / { try_files $uri /index.html; }`
- Vercel：`{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`

## 数据权限

- 站点不需要读者登录：只用 publishable key 以 `anon` 读取 `content_documents` 的发布列，RLS 只放行已发布（`published_at` 非空）的行。
- 上线 / 下线由控制台的发布操作决定（`publish_document` / `unpublish_document`）。

## 缓存

只对静态资源做长缓存；不要在 CDN 层长时间缓存 Data API 响应（下线需要立即生效）。
