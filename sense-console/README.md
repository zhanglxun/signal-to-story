# Signal to Story Console

`sense-console` 是 Signal to Story 的可视化控制中心，负责选题判断、Agent 任务调度、执行状态、结论清单与内容资产关系展示。Agent 的异步执行和原始资产文件不在本工程中完成或保存。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

未配置 Supabase 时，登录页提供明确标识的本地演示入口；配置后只显示真实邮箱密码登录。

## Supabase

在 `.env.local` 写入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。认证使用 Supabase Auth 邮箱密码模式。业务表结构暂不创建，等待独立数据模型评审；详见 [docs/supabase-data-model.md](docs/supabase-data-model.md)。浏览器不得使用 `service_role` 密钥。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

技术基座：React 19、TypeScript 5.9、Vite 7、shadcn/ui 4.19 Base UI/Nova、Tailwind CSS 4、React Router 7、TanStack Query 与 Supabase。
