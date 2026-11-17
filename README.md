# 星火工厂 · Signal to Story

面向个人内容生产与 AI 协作的 **Content Ops 控制系统**：把信息、选题、稿件、视频、审核、发布和复盘组织成可查询、可审核、可追溯的生产流程。Agent 产出提案，人负责判断和放行。

产品中文名「星火工厂」，英文名「Signal to Story」。`sense-console`、`sense-site` 只是工程目录名。企业及版权标识暂用 `susesne.cn`。线上控制台：https://story.susense.cn/ （目前只部署了 V1）。

## 当前分支：0.5.0

0.5.0 从 `codex/0.3` 切出，正在按职责重整目录结构。**先读 [docs/architecture.md](docs/architecture.md)**：分层、目标目录、模块调用关系和调整顺序（R0～R5）都在里面。所有文档的入口是 [docs/README.md](docs/README.md)。

## 核心原则

1. Console 只做控制和展示，不跑长任务；长任务由出站 worker 从数据库认领执行。
2. 普通读写由浏览器经 Supabase RLS / RPC 直连，不建传统后端 API。
3. Postgres 管状态、队列和关系；媒体二进制放对象存储。
4. Agent 只出提案；批准、发布、付费渲染由人放行，并由数据库触发器和 RPC 强制执行。
5. 外部内容一律当作数据，不能当作指令；`service_role` 和各类密钥绝不进浏览器。
6. 先跑通一条真实链路，再加抽象和自动化。

## 目录（R1 搬家前）

```text
signal-to-story/
├── docs/              文档（唯一入口）
├── knowledge-base/    知识库默认种子（kb:seed 同步到 knowledge_entries）
├── sense-console/     控制台前端 + 暂存于此的 supabase/、workers/、video-factory/（R1 起拆到根目录）
└── sense-site/        读者站
```

## 本地验证

```bash
npm --prefix sense-console run typecheck && npm --prefix sense-console run lint
npm --prefix sense-console run test && npm --prefix sense-console run build
npm --prefix sense-console run demo:harness   # 出稿循环，使用假模型
npm --prefix sense-site run dev:demo          # 读者站演示模式
```

完整的命令、实现状态和已知断层见 [docs/status.md](docs/status.md)。
