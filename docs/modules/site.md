# 读者站 sense-site

> 由旧 sense-site PRD、SPEC 和建设计划精简而来。运行与部署方法见 `sense-site/README.md`、`sense-site/docs/deployment.md`。

## 1. 定位

面向读者的独立站点：只读取**人工批准并显式发布**的内容快照。它是独立工程、独立部署，与 Console 不共享代码，但共用同一个 Supabase 项目（包括 Auth 和对象存储）。迁移统一放在 `supabase/migrations`。后台审核通过、发到外部平台，都**不代表**在站点上线。

## 2. 页面（导航最多两级）

首页 `/` · 探索 `/explore`（主题、形式、栏目筛选和标题搜索）→ 内容 `/content/:slug` · 专题 `/topics` → `/topics/:slug` · 资源库 `/resources` · 我的 `/me`（收藏）。登录、注册、恢复密码是辅助路由。

## 3. 首版边界

- **纳入**：公开阅读；注册后可读的内容（public / registered 两级）；收藏、专题、基本搜索、资源鉴权下载；人工发布与下线。
- **后置**：支付、会员、订阅、评论、推荐、SSR / 完整 SEO（首版是 SPA，不承诺搜索收录）。
- **演示模式**：没有配置 Supabase 时进入演示模式，页面显示「演示数据」；配置后如果数据库出错只显示重试，绝不回退到演示数据。

## 4. 权限规则

- 读者不加入后台组织，也拿不到任何 `content.*` 能力。
- `anon` 只能读已上线的 public 条目的安全元数据；正文单独存放，按条目状态和访问级别授权；受限正文不能通过搜索、分页总数、关联查询或资源 URL 泄露。
- 发布事务：要求登录、同组织、具备 `content.publish`、源稿件为当前 approved 版本，在同一事务里写入不可变快照并切换公开指针。改稿不影响已上线的快照；下线立即撤销正文和资源授权。
- 受限资源放私有 bucket，用短时签名 URL 下载；Markdown 渲染禁用原始 HTML。

## 5. 现状（本地，未上线）

- 表：`site_settings / site_categories / site_topics / site_topic_items / site_entries / site_entry_bodies / site_release_* / site_resources / site_bookmarks`。线上另有一套旧的 `site_*` 表，计划退役。
- 发布需要先走数据库级批准（请求 → 批准 → 发布）。
- 47 条测试覆盖游客、已验证读者、未验证读者、后台成员和其他组织之间的隔离。

## 6. 0.5 调整方向

改为「成果」模型：`content_results`（slug、可见性、上线状态、当前版本指针）加 `content_result_versions`（不可变快照）；读者站只读 `public_results` 视图，读者角色对基础表没有 SELECT 权限。表设计在 R5 确认。
