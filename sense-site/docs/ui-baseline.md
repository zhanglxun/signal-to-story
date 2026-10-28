# 界面基线

读者站按需复制控制台的主题和基础组件，不引用控制台页面、菜单或 Supabase 单例。

基线提交：`db13ebfa2ef326213997e79e0362b8cf0fffed35`（`codex/0.3`）。

| 读者站文件 | 来源 |
| --- | --- |
| `src/index.css` | `sense-console/src/index.css`，文末追加 `.reading` 排版 |
| `src/lib/utils.ts` | `sense-console/src/lib/utils.ts` |
| `src/lib/query-client.ts` | `sense-console/src/lib/query-client.ts` |
| `src/components/theme-provider.tsx` | `sense-console/src/components/theme-provider.tsx`，去掉已由本站 ESLint 覆盖的文件头禁用注释 |
| `src/components/ui/button.tsx` | `sense-console/src/components/ui/button.tsx` |
| `src/components/ui/badge.tsx` | `sense-console/src/components/ui/badge.tsx` |
| `src/components/ui/card.tsx` | `sense-console/src/components/ui/card.tsx` |
| `src/components/ui/input.tsx` | `sense-console/src/components/ui/input.tsx` |
| `src/components/ui/label.tsx` | `sense-console/src/components/ui/label.tsx` |
| `src/components/ui/separator.tsx` | `sense-console/src/components/ui/separator.tsx` |
| `src/components/ui/skeleton.tsx` | `sense-console/src/components/ui/skeleton.tsx`，补了 `React` 类型导入 |
| `src/components/ui/empty.tsx` | `sense-console/src/components/ui/empty.tsx`，补了 `React` 类型导入 |
| `src/components/ui/alert.tsx` | `sense-console/src/components/ui/alert.tsx` |
| `src/components/ui/native-select.tsx` | `sense-console/src/components/ui/native-select.tsx` |

卡片、阅读页、导航和空态在 `src/components/site/` 里单独维护。依赖版本对齐 `sense-console/package-lock.json` 里已解析的版本，并锁在本目录的 `package-lock.json`。
