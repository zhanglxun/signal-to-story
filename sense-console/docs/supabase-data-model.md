# Supabase 数据模型设计入口

状态：账号与组织基座已落地；内容生产领域模型仍待独立设计与评审。

## 已落地：组织与账号基座

| 表 | 用途 | 浏览器权限 |
| --- | --- | --- |
| `organizations` | Signal to Story 组织信息 | 组织成员只读 |
| `profiles` | Auth 用户的展示资料与账号状态 | 同组织成员只读 |
| `organization_members` | 用户、组织和角色关系 | 组织成员只读 |
| `organization_roles` | 组织角色、能力集合与分配规则 | 组织成员只读 |
| `audit_events` | 高权限管理动作审计 | 具备 `account.manage` 的角色只读 |

默认角色为 `owner`、`admin`、`member`、`viewer`，作为 `organization_roles` 的种子数据。前端角色列表、账号角色显示和创建账号下拉框都读取该表，不再维护角色名称与说明的前端常量。当前暂不开放自定义角色的新增、编辑和权限树界面。

账号创建使用 `admin-create-account` Edge Function。函数从 `organization_roles.permissions` 验证调用者是否具备账号管理与目标角色分配权限，再在服务端调用 Supabase Admin API；浏览器不接触 secret/service-role 密钥。角色授权以 `organization_members` 与 `organization_roles` 为准，`app_metadata` 只作受控镜像，不作为当前 RLS 的唯一依据。

## 拟覆盖的核心对象

- `profiles`：账号展示资料与状态；可信角色关系存放在 `organization_members`，不使用可由用户修改的 `user_metadata` 做授权。
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

内容生产领域 ER 图与状态机、RLS 权限矩阵与测试、生成式 TypeScript Database 类型、Agent 写入契约与幂等机制。
