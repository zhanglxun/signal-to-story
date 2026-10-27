# Signal to Story 内容站 SPEC（规划草案）

日期：2026-10-27。状态：待用户确认；尚未实施。本文明确允许应用代码放在根目录 `sense-site/`，作为既有“应用代码放在 sense-console”约定的专项例外。

## 定位与工程边界

- `sense-console`：生产、编辑、审核、站点发布和运营控制台。
- `sense-site`：面向读者的内容浏览、专题、资源及个人收藏入口。工程名为 sense-site，用户可见产品名沿用 Signal to Story。
- 两个独立前端、独立构建与部署；共用现有 Supabase 项目、Auth 和对象存储。数据库迁移统一由 `sense-console/supabase/migrations/` 管理，不建立第二套数据库或迁移历史。
- 普通读取采用 Supabase Data API + RLS，授权发布采用受控数据库事务；不新增传统后端服务器，不在浏览器执行 AI 或媒体长任务。
- 站点只展示明确发布到站点的内容。后台审核通过、向公众号/X 发布、上传资产均不意味着站点上线。

## 技术与组件

React、TypeScript strict、Vite、React Router、Tailwind CSS、shadcn/ui（Base UI），与控制台保持同一技术路线。数据请求放在 `sense-site/src/services/`，复用 React Query 的查询缓存方式。

实施时以控制台 lockfile 解析版本为基准，新增依赖固定版本并提交独立 lockfile；不直接采用动态 latest。按需复制既有基础 UI 组件、cn 工具、语义主题 token 和字体配置，记录来源文件及基线提交；阅读排版、内容卡片等站点组件在站点内维护。不导入后台页面、后台权限菜单或后台 Supabase 单例。不引入第二套组件库。初期不创建共享 packages；重复维护成本实际出现后再提取。

## 数据发布边界

现有 `content_documents`、`content_revisions`、Brief、审核事件和外部发布记录受组织 RLS 保护，维持该边界。公共读者不加入后台组织，注册也不授予 `content.view/manage/review/publish`。

新增独立站点发布层，以下名称为拟定逻辑模型，字段及迁移在开发阶段定稿：

| 对象 | 关键字段与职责 | 公开范围 |
| --- | --- | --- |
| site_settings | site_id、所属 organization_id、名称、简介、基础 URL、状态 | 仅展示字段；管理字段受组织权限控制 |
| site_categories | site_id、slug、名称、介绍、排序、启用状态 | 已启用分类 |
| site_topics / site_topic_items | 专题标题、slug、介绍、封面、已上线条目及排序 | 已上线专题及可见条目 |
| site_entries | site_id、id、slug、标题、人工摘要、分类、形式、栏目、封面、access_level、published_at、当前发布版本、上线/下线状态 | 已上线条目的安全元数据；不含完整正文或私有源文件地址 |
| site_entry_bodies | entry_id、发布版本、正文快照、引用来源、读者可见媒体引用 | 按条目状态及访问级别判定，RLS 独立保护 |
| site_release_sources / site_release_events | 发布版本对应源 document_id/revision、发布人、时间、上下线及替换事件 | 仅后台；组织与源稿复合外键约束，禁止跨组织引用 |
| site_resources | 条目关联的下载对象及访问级别 | 元数据可展示；下载受独立鉴权 |
| site_bookmarks | user_id、entry_id、created_at，用户与条目唯一 | 本人可增删查；条目下线时不再返回其受限信息 |

分类按主题组织；形式为 article/tutorial/video/comic/resource，栏目为 news/analysis/how_to/case；专题独立于分类。首版上线文章、图文教程和已有资源，其余形式不显示空入口。可先每条内容一个主分类，标签多选在后续扩展。

发布动作由有 content.publish 权限的人发起，必须在同一事务内重新核对组织、源稿当前 revision 及 approved 状态，创建不可变站点正文快照并切换公开指针、记录操作者；客户端不能直接写入 published 状态或修改发布正文。新内容、改标题、改正文、改变访问级别均走发布事务，不能绕过门禁。更新内容必须重新审核后发布。初版允许选择已批准母稿或平台稿作为来源，但站点标题和正文与批准版本一致；需要改写则先回后台产生新版本审核。

上线后源稿继续修改不影响已发布快照；下线立即取消该条目及正文、资源授权。旧快照只留内部审计，不作为可猜 ID 的公开版本 API。已经下载的内容无法召回。外部平台七种 platform 枚举不强行扩展为站点；站点发布有独立记录，后台通过关联呈现统一的发布状态。

## 读者身份与权限

| 身份 | 基础公开全文 | 注册可读全文 | 会员正文/下载 | 后台组织数据 |
| --- | --- | --- | --- | --- |
| 未登录访客 | 可 | 仅安全摘要 | 后续仅安全摘要 | 不可 |
| 注册读者 | 可 | 可 | 后续按有效权益 | 不可 |
| 后台成员 | 依读者规则 | 已注册时可 | 不自动拥有会员权益 | 按已有组织权限 |

首版 access_level 支持 public / registered；member / purchase 属于后续设计，首版禁止发布这些级别，避免空付费能力。注册用户须完成邮箱验证；不启用匿名 Auth 账号来替代游客。如现有项目已开启匿名登录，策略还须排除匿名身份。

为 `anon`/`authenticated` 明确授予最小 SELECT 权限并为每张暴露表启用 RLS。public 可读的列集合绝不包含受限正文；正文独立关系按状态和身份授权。不能仅靠前端隐藏，也不能通过搜索、相关推荐、分页总数、嵌入关系或资源 URL 返回未授权正文。普通读者只能修改自己的收藏，不能写发布表。

优先 SECURITY INVOKER；公开视图须显式采用 security_invoker。如发布事务确需受控提权，开发时单独评审函数授权、固定 search_path、身份/组织/权限/版本检查及 EXECUTE 范围，撤销默认 PUBLIC 执行；不得把 definer 当权限报错的修复捷径。浏览器仅配置 URL + publishable key，无 service_role 或其他秘密。

## 资源与内容安全

- 媒体继续存对象存储。仅显式选为公开的展示资产进入公开 bucket/路径，不把整个后台素材库设为公开。
- 注册或后续付费资源存私有 bucket，由 Storage RLS 或鉴权短请求签发短时 URL；猜 ID、过期 URL、撤回后新下载都必须验证。受限封面使用公开派生图而非原始文件地址。
- Markdown 禁用原始 HTML或进行严格清洗；链接、媒体 URL 校验协议。发布字段使用白名单，不能把内部 Brief、审稿备注或模型配置当摘要输出。
- 公开缓存只缓存 public 内容；registered 正文及个人数据不进入公共 CDN、预渲染、日志或构建产物。退出登录清理用户查询缓存。下线后的缓存失效纳入验收。

## 接口草案

全部为拟定契约；尚无这些线上接口。服务层以 Supabase Data API 查询为主：

| 操作 | 输入与输出约定 |
| --- | --- |
| listEntries | site_id、分类/形式/栏目、关键词、游标、limit（默认12，上限50）；返回安全卡片、next_cursor |
| getEntry | site_id + slug；可见元数据及公开/注册锁定状态；未发布/不存在返回不可见 |
| getEntryBody | entry_id + 当前发布版本；授权时返回 Markdown、公开引用；未授权不返回正文 |
| listCategories / listTopics / getTopic | 当前站点的可见分类、专题及条目；不展开隐藏条目 |
| listBookmarks / addBookmark / removeBookmark | 当前 auth.uid 的收藏；服务端再次校验归属和条目可见性 |
| getResourceAccess | 资源 ID；满足授权才允许对象读取或签发短时 URL |
| publishSiteEntry / unpublishSiteEntry | 登录、同组织 content.publish、当前已批准版本；事务化写入并返回发布结果 |

稳定排序为 published_at DESC、id DESC；同排序游标避免翻页重复。搜索首版仅检索已上线安全标题和摘要，不在客户端拉取全库。中文分词先验证，MVP 可使用带长度和分页限制的子串查询，数据量增长后再选择索引方案。

## 部署与搜索可见性

首版采用 Vite SPA，独立站点 origin 与控制台隔离，配置 SPA 回退和直接访问详情路径。域名由用户部署时确定，不占用现有控制台域名，不预设生产 URL。

SPA 首版不承诺完善的搜索收录或逐页社交分享卡片。若确认首发即依赖 SEO 获客，则在开工前提升为必做项：评估公开内容预渲染及发布/下线重建机制；仅预渲染 public，禁止带入注册正文。SSR/新渲染依赖需另行评估，不能默认为已支持。注册回调需分别配置站点 URL 和允许重定向列表；生产注册与会员功能按 HTTPS 部署验收。

## 后续会员模式

会员与后台角色分离；后续由可信端保存带起止时间的权益记录，RLS 实时判断。支付订单、回调验签、幂等、退款/到期撤权和下载授权一起验收后再开放支付。收藏不等于专题订阅；邮件推送、评论、购买和付费会员均不纳入首版承诺。
