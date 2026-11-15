# 星火工厂 V2 验收清单（P1.5 ～ P7）

> **生成时间**：2026-11-15 21:35  
> **总体状态**：代码完成，本地自动验证全部通过，**线上未部署**。  
> **未提交**：所有改动都在工作区，没有 commit，没有连接或修改线上 Supabase。

清单分三部分：A 是已经自动验证过的，你跑一条命令就能复现；B 是不需要后端、打开浏览器就能点的；C 是必须先把 migration 推到线上才能测的。

---

## 最近一次全量验证结果（2026-11-15 21:29 ～ 21:33）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm --prefix sense-console run typecheck` | 通过 |
| 静态检查 | `npm --prefix sense-console run lint` | 通过 |
| 单元 / 集成 / 数据库测试 | `npm --prefix sense-console run test` | 38 个文件，291 条全部通过 |
| 生产构建 | `npm --prefix sense-console run build` | 通过（仅有原有的包体积警告） |
| Python 视频 worker 测试 | `npm --prefix sense-console run test:video-worker` | 通过 |
| 读者站类型检查 / 测试 / 构建 | `npm --prefix sense-site run typecheck`、`test`、`build` | 通过，47 条测试全部通过 |
| 内核演示 | `npm --prefix sense-console run demo:harness` | PASS |
| 速记闭环演示 | `npm --prefix sense-console run demo:capture` | PASS |
| 视频工坊演示 | `npm --prefix sense-console run demo:video` | PASS |

数据库相关测试都在进程内 Postgres（PGlite）上应用全部 migration 后执行，不是真实 Supabase。

---

## A. 一条命令复现（不需要后端，不产生费用）

每条命令最后一行应为 `PASS`。全部使用假模型，不调用任何付费接口。

### A1. P1.5 内核：生成 ↔ 评估循环

```
npm --prefix sense-console run demo:harness
```

- [ ] 场景 1：第 1 轮评估不通过（提示某句话在信源里没有依据）→ 第 2 轮重写后通过 → 任务状态 `pending_review`，产生一条提案，正式稿件没有被改动（`revision=1`）。
- [ ] 场景 2：三轮都不通过 → 任务状态 `blocked_needs_human`，没有提案。
- [ ] 最后一行：`PASS: scenario1=pending_review scenario2=blocked_needs_human`

### A2. P3 速记：一条链接进来到待审提案

```
npm --prefix sense-console run demo:capture
```

- [ ] 打印完整链路：保存信源 → 建选题 → 立项 → 建母稿和平台稿 → 入队 → 抓取正文 → 生成 → 评估 → 待审提案。
- [ ] 同一请求重复提交返回 `duplicate=true`，不产生重复项目或任务。
- [ ] 最后一行：`PASS: 2/2 pending_review proposals`

### A3. P5 视频工坊：大纲到成片

```
npm --prefix sense-console run demo:video
```

- [ ] 分镜拆解第 1 轮被结构校验打回，第 2 轮通过，产生提案。
- [ ] 人工采纳后才写入 4 个镜头的正式方案。
- [ ] 未批准的云端渲染被数据库拒绝；本地免费预览可以直接入队。
- [ ] 没有批准权限的成员批准被拒；负责人批准成功。
- [ ] Python worker 渲染并合成，生成占位成片（约 18 KB 的 mp4）。
- [ ] 修改一句台词后方案版本升级，旧批准自动失效。
- [ ] 最后一行以 `PASS` 开头。

### A4. 门禁与数据库权限

```
npm --prefix sense-console run test
npm --prefix sense-site run test
```

- [ ] sense-console：291 条通过。覆盖跨组织隔离、并发认领不重复、Agent 不能自批、版本变更使批准和排期失效、未审核知识不进系统指令区、无批准不能发布到站点、未批准的付费渲染不能入队、IM 重复消息只收录一次。
- [ ] sense-site：47 条通过。覆盖游客 / 已验证读者 / 未验证读者 / 后台成员 / 其他组织的可见性隔离。

---

## B. 浏览器可点（不需要后端）

### B1. P7 读者站演示模式

```
npm --prefix sense-site run dev:demo -- --host 127.0.0.1
```

打开终端里显示的地址。每页顶部应有“演示数据”横幅。

- [ ] `/` 首页：最新内容和专题入口。
- [ ] `/explore`：列表，可按类型、分类、关键词筛选。
- [ ] `/content/why-enterprise-agents-stall`：公开文章，游客可读。
- [ ] `/content/ai-cost-ledger-template`：仅注册可读，未登录只看到摘要和锁定提示。
- [ ] `/register` 或 `/login`：任意邮箱加 8 位以上密码登录，登录后回到上一篇文章并能读全文。
- [ ] `/content/three-minute-content-pipeline`：视频播放器。
- [ ] `/topics` → `/topics/enterprise-agent-path`：专题页。
- [ ] `/resources`：下载需要登录。
- [ ] `/me`：收藏和退出登录。
- [ ] `/content/withdrawn-entry` 和任意不存在的路径：404 页。
- [ ] 深浅主题切换、手机宽度下布局正常。

### B2. 本地桥安全（需要 `npm --prefix sense-console run dev`）

- [ ] 「大模型接入」「CLI Agents」页面仍能正常显示状态。
- [ ] 在另一个终端执行 `curl -X POST http://127.0.0.1:<端口>/__sense_bridge/chat -H 'Content-Type: application/json' -d '{}'`，应返回 403（没有令牌）。

---

## C. 部署后才能测（需要你先点头并执行部署）

### C0. 部署步骤

1. **应用 migration**，严格按文件名顺序，共 11 个，位于 `sense-console/supabase/migrations/`：
   1. `20261115100000_agent_jobs_queue.sql`
   2. `20261115100100_decision_memories_knowledge.sql`
   3. `20261115100200_approval_requests_mandate.sql`
   4. `20261116100000_create_site_publishing.sql`
   5. `20261116100100_site_publish_functions.sql`
   6. `20261117100000_quick_capture.sql`
   7. `20261119100000_site_publish_mandate.sql`
   8. `20261120100000_video_studio.sql`
   9. `20261120100100_video_studio_mandate.sql`
   10. `20261121100000_im_channels.sql`
   11. `20261122100000_publication_video_asset.sql`

   用 `supabase db push`，或在 SQL Editor 里按顺序粘贴执行。**不要手工建表**。
2. **导入知识库种子**：执行 `sense-console/supabase/seeds/knowledge_base.sql`。
3. **部署 Edge Functions**：`content-draft`、`intake-gateway`、`im-webhook`（后者需要 `--no-verify-jwt`）。所需 Secret 名称见 `sense-console/docs/im-channels.md` 和 `sense-console/supabase/functions/README.md`。
4. **启动 worker**：按 `sense-console/workers/agent/.env.example` 配好环境变量后运行 `npm --prefix sense-console run worker:agent`。视频 worker 见 `sense-console/workers/video/README.md`。
5. **构建并部署两个前端**：`sense-console` 和 `sense-site`。

注意：migration 会新增私有存储桶（`site-resources`、`video-studio`）和存储策略，应用前请看一眼对线上权限的影响。

### C1. P3 速记与任务中心

- [ ] 顶栏「速记」按钮或 `Cmd/Ctrl+K` 打开速记框。
- [ ] 粘贴一条链接，选「仅收录」→ 选题池里出现该条。
- [ ] 粘贴一条链接，选「自动出稿到待审」并勾选平台 → 「任务中心」的「进行中」出现任务。
- [ ] worker 运行后，任务进入「等我审核」；详情页能看到每一轮的生成、预检、评估清单、模型、用量和耗时。
- [ ] 稿件页的 AI 提案上显示“来自任务、评估了几轮”，可跳到任务详情。
- [ ] 连续点两次提交，只产生一组项目和任务。
- [ ] 手机浏览器打开 `/capture`，可提交；「更多入口」里有书签、快捷指令和 IM 机器人的配置说明。
- [ ] 工作台有「待我处理」摘要卡，数字与任务中心一致。

### C2. P6a 决定记忆与知识库

- [ ] 稿件审核点「退回」，填理由并勾选「记入长期创作偏好」→「内容中心 → 决定记忆」出现该条。
- [ ] 对同一稿件再次自动出稿，任务详情的上下文步骤里记忆条数加 1。
- [ ] 「内容中心 → 知识库」导入一个 `.md` → 状态为“未审核”，页面提示未审核内容不进入系统指令区。
- [ ] 有审核权限的账号能「标记可信」；没有权限的账号看不到该按钮。
- [ ] 复盘页填写改进变量并勾选记忆 → 出现一条风格规则。

### C3. P6b 发布到读者站与排期

- [ ] 已审核通过的稿件，详情页审核卡片下方出现「发布到读者站」面板。
- [ ] 三步分别点击：请求发布批准 → 批准 → 发布到站点。
- [ ] 读者站上能看到该内容；点「下线」后读者站不再显示。
- [ ] 修改稿件产生新版本后，面板提示旧批准已失效，直接发布被拒绝。
- [ ] 发布页的「排期视图」按日期分组显示计划；稿件出新版本后，旧排期标红为已作废。

### C4. P5 视频工坊

- [ ] `/video/storyboards`：输入大纲 → 触发拆解 → 出现分镜提案 → 采纳。
- [ ] 分镜卡片可改台词、音色、运镜方式，可增删，可上移下移。
- [ ] 把某个镜头改为云端视频模型 → 入队被拒，提示需要批准；请求批准并批准后可以入队。
- [ ] 本地运镜预览不需要批准即可入队。
- [ ] 成本面板显示预估与实际成本。
- [ ] 合成完成后可在页面内播放成片，并能「加入发布计划」。

### C5. P4 飞书 / 企微

- [ ] 按 `sense-console/docs/im-channels.md` 配置后，平台侧 Webhook 握手成功。
- [ ] 在飞书或企微给机器人发一条链接 → 收到回执，选题池出现该条。
- [ ] 发“出稿”前缀加链接 → 触发自动出稿，任务完成后收到待审卡片。
- [ ] 卡片上的「查看并审核」「打开任务」能跳到控制台对应页面。
- [ ] 同一条消息被平台重试时，不产生重复收录。

### C6. P7 读者站（真实后端）

- [ ] 配置 Supabase 变量后启动 `sense-site`，页面不再显示“演示数据”横幅。
- [ ] 游客只能看到公开且在线的内容。
- [ ] 注册读者验证邮箱后能读注册级内容、收藏、下载资源。
- [ ] 读者账号登录后台控制台，没有任何后台权限。

---

## 已知未完成与未验证

这些不是测试点，是你测试时会碰到的边界。

**没有做**

- 部署用的 Dockerfile 和 docker-compose（原定的集成收尾第 7 项，因额度暂停未做）。
- 组织级模型密钥配置（BYOK）及其加密存储；worker 目前读自己的环境变量。
- 按组织签发的受限 worker 凭证；worker 目前使用数据库最高权限凭证，放在个人电脑上有风险。
- 计费、租户自助入驻。
- IM 内一键批准：需要先设计 IM 用户与后台账号的身份绑定，目前卡片只是跳转链接。
- 创建飞书 / 企微连接的界面（目前需要用 SQL 插入）。
- 视频：关键帧上传或自动生成、云端 TTS 引擎、图形化多轨时间线、拖拽排序。真实引擎下，没有关键帧的本地镜头会失败。

**没有验证**

- 真实 Supabase 下的 Data API、存储签名链接、注册登录：全部只在进程内 Postgres 和假客户端上测过。
- Edge Function 的入队模式，以及 `im-webhook` 在 Deno 下能否打包（它引用了函数目录外的文件）。
- 飞书的握手、事件结构、卡片 JSON、发消息接口，企微的签名算法和群机器人推送格式：按记忆实现，没有对照官方文档，真实联调时很可能要调整。
- Codex 没有真实调用过；pi、opencode、agy 的无交互参数未核实，worker 会拒绝使用它们。
- 真实视频模型、真实 TTS、全分辨率合成和真实计费。
- 所有控制台页面都没有在真实浏览器里点过，只有编译加载和组件测试。C 部分的每一条都是第一次真人点测。

**待你决定**

1. 工作区物化协议与 CLI 会话续接要不要做。建议暂不做：需要放弃只读沙箱，安全模型要重新设计。
2. 预算口径：旧文档是“不设硬预算、只记 token”，V2 内核已实现预算熔断。建议以 V2 为准。
3. 被删除的 `frame-work.md` 里的 Supabase 安全验收清单是否并入 `sense-console/docs/supabase-data-model.md`。建议并入。
