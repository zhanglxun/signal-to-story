# Supabase 数据模型设计入口

状态：账号与组织基座、V1 资产元数据账本、知识库内容（分类/待处理信息/选题）和提示词与图例库已落地；其余内容生产领域模型仍待独立设计与评审。

## 已落地：组织与账号基座

| 表 | 用途 | 浏览器权限 |
| --- | --- | --- |
| `organizations` | Signal to Story 组织信息 | 组织成员只读 |
| `profiles` | Auth 用户的展示资料与账号状态 | 同组织成员可读；本人仅可更新显示名称 |
| `organization_members` | 用户、组织和角色关系 | 组织成员只读 |
| `organization_roles` | 组织角色、能力集合与分配规则 | 组织成员只读 |
| `audit_events` | 高权限管理动作审计 | 具备 `account.manage` 的角色只读 |
| `assets` | 角色、场景、道具、音效与风格的资产元数据 | `content.view` 只读；`content.manage` 新增和更新 |

默认角色为 `owner`、`admin`、`member`、`viewer`，作为 `organization_roles` 的种子数据。前端角色列表、账号角色显示和创建账号下拉框都读取该表，不再维护角色名称与说明的前端常量。当前暂不开放自定义角色的新增、编辑和权限树界面。

账号创建使用 `admin-create-account` Edge Function。函数从 `organization_roles.permissions` 验证调用者是否具备账号管理与目标角色分配权限，再在服务端调用 Supabase Admin API；浏览器不接触 secret/service-role 密钥。角色授权以 `organization_members` 与 `organization_roles` 为准，`app_metadata` 只作受控镜像，不作为当前 RLS 的唯一依据。

个人资料页通过 Data API 更新当前用户自己的 `profiles.display_name`，RLS 与列级 `GRANT` 会阻止浏览器修改邮箱、账号状态和其他用户资料。登录密码通过当前 Supabase Auth 会话调用 `updateUser` 更新，密码明文不会写入业务表或浏览器存储。

## 已落地：V1 资产元数据账本

`assets` 是浏览器、Agent 和后续 Worker 共用的资产索引，不保存图片、音频、视频或模型二进制。当前字段与原始 `c_assets` 草案的映射如下：

| 原草案 | 当前字段 | 调整原因 |
| --- | --- | --- |
| `id BIGSERIAL` | `id bigint identity` | 使用 SQL 标准自增主键 |
| `user_id` | `created_by` / `updated_by` UUID | 资产归组织所有，用户字段只承担审计；与 Supabase Auth 对齐 |
| `org_id` | `organization_id` UUID | 与现有 `organizations.id` 对齐 |
| `type INT` | `asset_type text` | 避免魔法数字；限制为 `character/scene/prop/sound/style` |
| `category INT` | `category text` | 二级分类可扩展，不必每次新增分类都迁移数据库 |
| `cloud_url` | `cloud_url` | 保存对象存储或受控外部地址 |
| `local_url` | `local_path` | 明确它是设备路径；可写入但不授权给普通 Web 查询 |
| `status INT` | `is_active boolean` | 当前只有启用/停用两态，使用布尔值更准确 |
| `create_time/modify_time` | `created_at/updated_at timestamptz` | 统一时区与项目命名规范 |

为列表预览增加 `media_type` 和 `thumbnail_url`；为 Agent 扩展增加受约束的 `metadata jsonb`。名称、二级分类和描述生成 `search_text`，并使用 trigram 索引支撑包含式文本搜索。

权限采用 RLS 与显式 GRANT 双层控制：Viewer 及以上可读取，Member 及以上可登记和更新，不向浏览器授予 DELETE。停用资产使用 `is_active=false`；后续需要版本和物理清理时，再通过 `asset_versions` 与受控 Worker 流程处理。

## 已落地：知识库内容（分类 / 待处理信息 / 选题）

`source_categories`、`signals`、`selections` 对应 `docs-site/spec/SignalToStory项目数据库文档.md` 的 `c_category`/`c_signal`/`c_selection` 草案，字段调整如下：

| 表 | 原草案 | 当前字段 | 调整原因 |
| --- | --- | --- | --- |
| c_category → `source_categories` | 无组织字段 | `organization_id uuid` | 与 `assets` 一致：RLS 必须绑定真实 workspace，不能只写 `TO authenticated` |
| | `sort_id Int`（字段说明写"用户的ID"，疑似笔误） | `sort_order smallint` | 结合实际用途（树形展示顺序）改名 |
| | `status int 1/0` | `is_active boolean` | 与 `assets.is_active` 同一习惯 |
| c_signal → `signals` | 无组织字段 | `organization_id uuid` | 同上 |
| | `status int 1未整理/0已整理` | `is_organized boolean` | 二态工作流标记 |
| | `category_id` | `... references source_categories(id) on delete restrict` | 分类仍被引用时拒绝删除，而不是级联 |
| c_selection → `selections` | 无组织字段 | `organization_id uuid` | 同上 |
| | `signal_id` | `... references signals(id) on delete restrict` | 防止孤儿选题 |
| | `priority int 1/2/3`、`status int 1未完成/0已完成` | `priority smallint check in (1,2,3)`、`is_completed boolean` | 去掉魔法数字歧义 |
| | `outline_template JSON` | `outline_template jsonb`，`[{"title": "..."}]`，`check (jsonb_typeof=array)` | 落地为章节标题的有序列表 |

`source_categories` 用 `parent_id` 自关联两层结构，`private.enforce_source_category_depth()` 触发器阻止出现第三层。三张表都通过 `private.set_audit_fields()` 通用触发器维护 `created_by/created_at/updated_by/updated_at`，权限沿用已有的 `content.view`/`content.manage`。

分类父子关系、信息所属分类和选题所属信息都使用 `(organization_id, 关联 ID)` 复合外键，数据库层会拒绝跨组织误关联，避免只依赖 RLS 维持租户边界。

和 `assets` 不同的是，这三张表**都对浏览器开放了 DELETE**（`content.manage` 权限 + RLS）：`signals` 是收件箱性质的队列，`selections` 是本轮明确要支持删除的对象，`source_categories` 的删除风险已经由外键 `on delete restrict` 挡住（分类下还有子分类，或已被 `signals` 引用时，数据库直接拒绝，由 service 层捕获 `23503` 转成友好提示）。

## 已落地：提示词与图例库

`prompt_examples` 管理网络收集与自主创作的提示词，并可保存外部图例地址、私有 Storage 图例对象，或可选关联一条现有图片资产。它不把提示词伪装成图片资产类型：提示词是可复用的创作参考，图片仍由 `assets` 账本管理。

表内保留 `source_url`、`source_author`、`origin_type`、`tags`、`status` 和 `notes`，满足轻量收集与整理；`visibility` 只保存 `private/shared` 意图，当前没有匿名读取策略或公开发布页面。`example_asset_id` 与 `organization_id` 一起引用 `assets`，防止把其他组织的图例错误关联进来。

上传图例使用私有 `prompt-examples` bucket：对象路径第一段为 `organization_id`，Storage RLS 使用同一套 `content.view` / `content.manage` 权限。表中只保存 `example_storage_path`；读取列表时由前端按已登录会话申请一小时有效的签名预览 URL，避免公开图片链接。

访问规则与知识库内容一致：`content.view` 可读取，`content.manage` 可新建、编辑和删除；审计触发器维护创建与更新时间及操作人。

## 拟覆盖的核心对象

- `profiles`：账号展示资料与状态；可信角色关系存放在 `organization_members`，不使用可由用户修改的 `user_metadata` 做授权。
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
