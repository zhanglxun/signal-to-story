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
| `VITE_SITE_SLUG` | 服务的 `site_settings.slug`，默认 `signal-to-story` |
| `VITE_SITE_DEMO` | 仅本地演示时设为 `1`；生产必须为空 |

## SPA 回退

所有未命中静态文件的路径都要返回 `index.html`（HTTP 200），否则直接打开 `/content/:slug`、`/topics/:slug` 会 404。

- Netlify / Cloudflare Pages：已提供 `public/_redirects`（`/* /index.html 200`）。
- Nginx：`location / { try_files $uri /index.html; }`
- Vercel：`{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`

## Supabase Auth

- Site URL / Redirect URLs 加入站点域名的 `/login?confirmed=1` 与 `/update-password`，与控制台域名分别配置，不要改动控制台已有回调。
- 读者注册需开启邮箱确认并配置自有 SMTP；未确认邮箱的账号只能读 public 内容。
- 若项目启用了匿名登录，RLS 已排除 `is_anonymous` 身份。
- 站点在 `site_settings.status = 'online'` 前对外不可见；默认迁移只创建 draft 站点。

## 缓存

只对静态资源做长缓存；不要在 CDN 层缓存 Data API 响应（注册正文属于个人数据）。
