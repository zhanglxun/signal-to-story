# 星火工厂 · Signal to Story

面向个人内容生产与 AI 协作的 **Content Ops 控制系统**：把信息、选题、稿件、视频、审核、发布和复盘组织成可查询、可审核、可追溯的生产流程。Agent 产出提案，人负责判断和放行。

产品中文名「星火工厂」，英文名「Signal to Story」。`sense-console`、`sense-site` 只是工程目录名。企业及版权标识暂用 `susesne.cn`。线上控制台：https://story.susense.cn/ （目前只部署了 V1）。

## 当前版本：0.5.0（已合并进 `main`）

0.5.0 按职责重整了目录结构，并让 Chat 在生产可用；当前在做迭代 1「打磨与优化」（[docs/tasks/iteration-1.md](docs/tasks/iteration-1.md)）。**先读 [docs/architecture.md](docs/architecture.md)**：分层、目标目录、模块调用关系和调整顺序（R0～R5）都在里面。所有文档的入口是 [docs/README.md](docs/README.md)。

## 核心原则

1. Console 只做控制和展示，不跑长任务；长任务由出站 worker 从数据库认领执行。
2. 普通读写由浏览器经 Supabase RLS / RPC 直连，不建传统后端 API。
3. Postgres 管状态、队列和关系；媒体二进制放对象存储。
4. Agent 只出提案；批准、发布、付费渲染由人放行，并由数据库触发器和 RPC 强制执行。
5. 外部内容一律当作数据，不能当作指令；`service_role` 和各类密钥绝不进浏览器。
6. 先跑通一条真实链路，再加抽象和自动化。

## 目录

```text
signal-to-story/
├── docs/              文档（唯一入口）
├── knowledge-base/    知识库默认种子（kb:seed 同步到 knowledge_entries）
├── supabase/          迁移、RLS、RPC、Edge Functions（_shared/ 放函数共享代码）、数据库测试
├── workers/           长任务进程：agent/（Node，本机节点）、video/（Python，engine/ 为视频引擎）
├── testing/           共享测试基建（PGlite harness 等）
├── sense-console/     控制台前端（只是 Web）
├── sense-site/        读者站
└── package.json       运行时一侧（workers、数据库测试、testing）的依赖与命令
```

## 本地验证

```bash
npm install && npm run typecheck && npm run lint && npm test   # 运行时：workers + 数据库（PGlite）
npm run test:video-worker                                       # Python 视频 worker
npm run demo:harness                                            # 出稿循环，使用假模型
npm --prefix sense-console run typecheck && npm --prefix sense-console run lint
npm --prefix sense-console run test && npm --prefix sense-console run build
npm --prefix sense-site run dev:demo                            # 读者站演示模式
```

完整的命令、实现状态和已知断层见 [docs/status.md](docs/status.md)。
