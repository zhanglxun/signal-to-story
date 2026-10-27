# sense-site

Signal to Story 面向读者的内容站工程。当前处于规划阶段，尚无可运行应用；此目录先保存工程入口说明。

- [产品页面与首版范围](../docs-site/design/sense-site-PRD.md)
- [架构、数据与权限方案](../docs-site/spec/sense-site-SPEC.md)
- [分阶段建设与验收计划](../docs-site/plan/sense-site-plan.md)

拟采用与 sense-console 相同的 React / TypeScript / Vite / React Router / Tailwind CSS / shadcn（Base UI），按需沿用组件与主题。数据库来自现有 Supabase；游客可读取明确发布的基础内容，注册读者与后台组织成员权限分离。

规划确认后再建立 src、依赖、构建配置及运行命令。数据库迁移统一维护在 sense-console/supabase，本站不创建第二套迁移目录。
