# Supabase 数据模型设计入口

状态：待独立设计与评审。本文件只定义边界，不提前固化业务表。

## 拟覆盖的核心对象

- `profiles`：账号的可信服务端角色与工作空间关系，不使用可由用户修改的 `user_metadata` 做授权。
- `topics`：选题、信号来源、评分、状态与判断结论。
- `agent_tasks`：异步任务、执行者、输入引用、进度、错误与输出引用。
- `stories` / `story_nodes`：故事与章节、场景、分镜等结构关系。
- `assets` / `asset_versions`：图片、音频、人物、场景与视频的元数据、外部存储地址和版本。
- 关系表：选题、任务、故事节点和资产之间的可追踪关联。

## 安全与访问约束

1. 所有通过 Data API 暴露的表必须显式开启 RLS，并编写最小权限策略。
2. Schema migration 同时包含 `GRANT` 与 RLS policy；不能把“已开启 RLS”误当成“已暴露 API”。
3. 浏览器只使用 Publishable Key；`service_role` 只能存在于受控服务端或 Edge Function。
4. 普通 CRUD 由 `supabase-js` 直接访问；密钥调用、Webhook、复杂校验才使用 Edge Function。
5. 原始大文件不进数据库。数据库保存存储 provider、bucket/path、版本、哈希和关系。

## 下一步设计输出

ER 图与状态机、migration SQL、RLS 权限矩阵与测试、TypeScript Database 类型、Agent 写入契约与幂等机制。
