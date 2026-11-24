# R2～R3 并行开发分工与合并规则

> 2026-11-24 · 状态：**执行中**（前端第一波已于 2026-11-24 验收合并；数据库第一波执行中；Worker 的 R2 待 Codex 交叉评审，R3 内核在 `feat/r3-core`）。设计依据见 [../modules/chat.md](../modules/chat.md)（第 5 节为已确认决定）、[db3b-chat-runtime-catalog.md](db3b-chat-runtime-catalog.md)、[r1-to-r3-plan.md](r1-to-r3-plan.md)。全部合并验收后，结论写回模块文档，本文与各简报删除（文档维护规则第 4 条）。

## 1. 三条轨道

| 轨道 | 执行者 | 分支 / worktree | 第一波（现在） | 第二波（等通知） | 简报 |
| --- | --- | --- | --- | --- | --- |
| 数据库 | Codex | `feat/db3b` · `../sts-db` | 阶段 0（执行 step5 + 部署）→ DB3b → `0.5.0-step6.sql` | ACP 驱动、Vite 桥退役、模型 / CLI 配置页 | [brief-codex.md](brief-codex.md) |
| Worker 核心 | Claude | `feat/r2-loop` → `feat/r3-core`（叠在 R2 上）· `../sts-worker` | R2（内核迁入 `workers/agent/loop` + ESLint 门禁） | `AgentSessionDriver` 接口 → R3.0 端到端细切片 → R3-A | —（由 Claude 自行执行） |
| 前端 | Gemini 4 | `feat/chat-ui`（已合并）→ `feat/chat-ui-2` · `../sts-chat-ui` | Pi 厂商兼容 spike（只交结论）→ Chat UI Phase 1（假传输）**已合并** | 2A：Phase 2 组件 + 评审遗留（假传输）；2B：接真实 HTTP/SSE | [brief-gemini.md](brief-gemini.md) · [2A](brief-gemini-wave2a.md) |

**合并与验收：Claude。** 每个分支交付后由 Claude 评审、在本地合并到 `0.5.0`、跑全套门禁，通过后才提交；不合格就退回并写明原因。Claude 自己的分支由 Codex 交叉评审。

## 2. 冻结的约定（并行开发的前提）

改动以下任何一项，必须先在对应文档里改、通知另外两方，不能只改代码：

1. **DB3b 的表、列与 RPC 签名**：[db3b-chat-runtime-catalog.md](db3b-chat-runtime-catalog.md) 第 2 节。
2. **HTTP 接口与 SSE 事件**：[../modules/chat.md](../modules/chat.md) 2.3 表与 2.4「HTTP 接口约定」。
3. **`AgentSessionDriver` TS 接口**：第二波开始时由 Claude 在 `workers/agent/loop/` 写出并第一个合并，ACP 驱动以它为准。

`ChatStreamEvent` 不跨项目共享代码（`sense-console` 与 `workers` 互不引用），两边各自定义类型，以 chat.md 2.3 为唯一来源。

## 3. 目录归属（谁能改什么）

| 路径 | 归属 | 其他人 |
| --- | --- | --- |
| `supabase/migrations/`、`supabase/tests/db/`、`supabase/release/`、`testing/db/` | Codex | 只读 |
| `workers/agent/**`（第二波的 `drivers/acp-*` 除外）、根目录 `eslint.config.js`、`tsconfig.json` | Claude | 只读 |
| `sense-console/src/harness/`、`sense-console/src/contracts/`、`sense-console/src/services/agent-harness-service.ts`、`sense-console/src/pages/chat-assistant-page.tsx`、`sense-console/eslint.config.js` | Claude（R2） | 只读 |
| `sense-console/src/modules/chat/**`（新建）、`App.tsx` 中**新增一条** `/chat-next` 临时路由 | Gemini | 只读 |
| 根目录 `package.json` / lockfile | 第一波**谁都不改**；第二波 Pi 依赖由 Claude 加、ACP SDK 由 Codex 加 | — |
| `sense-console/package.json` / lockfile | Gemini 如确需新依赖，先在交付报告中说明理由 | — |
| `docs/status.md`、`docs/database.md`、`docs/architecture.md`、`docs/modules/*` | 只在合并时由 Claude 改 | 在交付报告里写建议改法 |

## 4. 分支规则

- 三个 worktree 都从 `0.5.0` 当前提交切出。只在自己的分支上提交；**不 push、不 merge、不 rebase 到别人的分支、不改 `0.5.0`**。
- 提交信息用 Conventional Commits（`feat(db): …`、`feat(chat-ui): …`），结尾带各自的 Co-Authored-By 署名。
- 合并顺序：`feat/r2-loop` → `feat/db3b` → `feat/chat-ui`（第一波）；之后其余分支 rebase 到新的 `0.5.0` 再继续第二波。
- lockfile 冲突一律重新 `npm install` 生成，不手工合并。

## 5. 交付报告格式（交给 Claude）

每个轨道完成后，按下面格式输出，用户转发给 Claude：

```text
## 交付报告：<轨道> · <分支名> · <最后一个提交的短 hash>
1. 完成项：逐条对应简报的验收标准，标「完成 / 未完成 / 有偏差」
2. 偏差与理由：任何偏离简报或冻结约定的地方
3. 门禁结果：每条命令 + 通过/失败（失败贴关键输出）
4. 需要 Claude 合并时更新的文档：文件 + 建议改法
5. 遗留问题 / 需要用户决定的事
```
