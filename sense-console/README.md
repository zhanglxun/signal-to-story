# Signal to Story Console

`sense-console` 是 Signal to Story 的可视化控制中心，负责选题判断、Agent 任务调度、执行状态、结论清单与内容资产关系展示。Agent 的异步执行和原始资产文件不在本工程中完成或保存。

## UI 基座

- 使用 shadcn/ui 最新版的 Base Nova（Base UI）官方预设，配置见 [`components.json`](components.json)。
- 登录页和控制台骨架分别以官方 `login-04`、`dashboard-01` Block 为结构基线。
- 官方组件源码已完整拉取到 [`src/components/ui`](src/components/ui)，业务页面只组合这些组件和语义主题变量。
- 外观设置仅使用 shadcn 官方主题色、明暗模式和圆角半径，不另建产品私有皮肤。

具体约束、来源和更新命令见 [`docs/shadcn-foundation.md`](docs/shadcn-foundation.md)。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

未配置 Supabase 时，登录页会显示配置提示并禁用提交；应用不提供绕过认证的演示入口。

## Supabase

在 `.env.local` 写入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。认证使用 Supabase Auth 邮箱密码模式。业务表结构暂不创建，等待独立数据模型评审；详见 [docs/supabase-data-model.md](docs/supabase-data-model.md)。浏览器不得使用 `service_role` 密钥。

Supabase Dashboard 的 Auth 配置还需满足：

- Email Provider 保持启用；后台不提供公开注册入口，正式环境建议关闭公开 Signup。
- Site URL 指向正式 Console 地址。
- Redirect URLs 至少包含本地和正式环境的 `/update-password` 地址。
- 上线密码找回前配置自有 SMTP；Supabase 默认邮件服务仅适合开发验证。

应用启动时使用 Auth 服务验证已保存会话，而不是仅信任浏览器缓存；登出默认只注销当前设备，并同时清除用户级 TanStack Query 缓存。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

技术基座：React 19、TypeScript 5.9、Vite 7、shadcn/ui 4.19 Base UI/Nova、Tailwind CSS 4、React Router 7、TanStack Query 与 Supabase。
