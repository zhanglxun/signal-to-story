# 文档入口

> 0.5.0 起所有文档只放在本目录。旧的 `docs-site/`、`sense-console/docs/` 已精简合并到这里后删除，原文可在 `codex/0.3` 分支的历史中查到。

| 文档 | 用途 | 什么时候读 |
| --- | --- | --- |
| [architecture.md](architecture.md) | 分层、目录、模块调用关系、调整顺序 | 动任何结构之前 |
| [product.md](product.md) | 产品定位、内容方法论、质量门禁 | 做内容相关功能、写 Agent 提示词或评估清单时 |
| [database.md](database.md) | 数据库目标模型、表归属、迁移步骤 DB0～DB7 | 动表结构或迁移之前 |
| [status.md](status.md) | 已实现什么、怎么本地验证、已知断层 | 判断某个能力能不能用时 |
| [research.md](research.md) | 外部 Agent 工程研究的结论 | 设计 Agent 循环和门禁时 |
| [ACP-info.md](ACP-info.md) | ACP 协议规范、多 CLI 接入矩阵与本地驱动安全边界 | 接入或改造本地 Agent CLI / ACP 时 |
| [modules/](modules/) | 每个模块一页：职责、现状、0.5 调整方向 | 改某个模块时 |
| [tasks/](tasks/) | 进行中的专项需求书与实施路线（评审与落位用） | 拆解或认领数据库/架构重构任务时 |
| [conventions/frontend.md](conventions/frontend.md) | 前端组件与 shadcn 约定 | 写前端时 |

模块文档：

- [data-model.md](modules/data-model.md)：组织与权限基座、资产、对象存储、Supabase 安全清单
- [harness.md](modules/harness.md)：Agent 任务队列、循环、Mandate 门禁
- [chat.md](modules/chat.md)：标准 Chat Agent 入口、Runtime & Model Catalog 与 Pi 内核设计
- [intake.md](modules/intake.md)：外部收录网关、Web 速记、飞书/企微
- [content.md](modules/content.md)：稿件、版本、审核、发布与复盘
- [video.md](modules/video.md)：视频工坊与视频 worker
- [site.md](modules/site.md)：读者站 sense-site

专项任务与实施规划：

- [db3b-chat-runtime-catalog.md](tasks/db3b-chat-runtime-catalog.md)：DB3b 数据库增量改造任务书（交数据库任务评审与执行）
- [r1-to-r3-plan.md](tasks/r1-to-r3-plan.md)：R1 → R3 六大断层分析与可执行任务计划

## 维护规则

1. **一个主题只写一处**。别处只放链接，不复制内容。
2. **事实、建议、决定分开标记**。「已有」指代码已经存在，不代表已经上线或验证过。
3. **代码旁边的 README 只写怎么运行**（例如 `workers/agent/README.md`），设计内容写在这里。
4. **完成的计划不保留**。结论写进模块文档，过程文档删掉，需要时去 git 历史里找。
5. 文档里不写密钥、线上项目 ID 和个人路径。
