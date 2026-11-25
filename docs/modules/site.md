# 读者站 sense-site

> 由旧 sense-site PRD、SPEC 和建设计划精简而来。运行与部署方法见 `sense-site/README.md`、`sense-site/docs/deployment.md`。

## 1. 定位

面向读者的独立站点：只读取**人工批准并显式发布**的内容快照。它是独立工程、独立部署，与 Console 不共享代码，但共用同一个 Supabase 项目（包括 Auth 和对象存储）。迁移统一放在 `supabase/migrations`。后台审核通过、发到外部平台，都**不代表**在站点上线。

## 2. 页面（导航最多两级）

首页 `/` · 探索 `/explore`（内容形式筛选和标题 / 摘要搜索）→ 内容 `/content/:slug`。专题、资源库、读者注册登录、收藏已随 DB4 下线（DB-D17）。

## 3. 边界

- **纳入**：公开阅读已发布的文章；人工发布与下线。
- **后置**：读者账号、注册可读、收藏、专题、资源下载、支付、评论、SSR / SEO（首版是 SPA）。
- **演示模式**：没有配置 Supabase 时进入演示模式，页面显示「演示数据」；配置后如果数据库出错只显示重试，绝不回退到演示数据。

## 4. 数据与权限（DB4）

- 站点直接读 `content_documents` 的发布列：`id, slug, published_revision, published_title, published_body, published_meta, published_at`。`published_meta` 存摘要、形式、封面、媒体与来源引用。
- `anon` 只被授予这些列的 SELECT，RLS 只放行 `published_at is not null` 的行；`select *`、草稿正文、审核意见一律拒绝。可选环境变量 `VITE_SITE_ORGANIZATION_ID` 只显示某个组织的内容。
- 发布只能经 `publish_document`：登录、`content.publish`、稿件为当前 approved 版本、并有绑定该版本的已批准 `publish_site` 请求（MD001 缺批准 / MD002 已过期）。发布把当前版本复制进发布列，之后改稿不影响线上；`unpublish_document` 清空 `published_at` 即下线。发布列只能由这些 RPC 写（触发器拦截直接更新）。
- 外部平台人工发布后用 `set_document_published_url` 回填链接，不抓数据。
- 测试：`supabase/tests/db/publish-document-db.test.ts`、`sense-site/src/test/db/site-permissions.test.ts`（真实迁移上的 anon 权限）。
