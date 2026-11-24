# 下一阶段分工与调度（T3 Code：Opus 主会话统筹 + 跨模型子代理）

> 2026-11-24 · 任务内容见 [next-phase.md](next-phase.md)；目录归属、分支规则与交付报告格式沿用 [parallel-plan.md](parallel-plan.md) 第 3～5 节。本文只规定**谁做、怎么派、怎么收**。

## 1. 角色

| 角色 | 由谁担任 | 职责 | 不做 |
| --- | --- | --- | --- |
| **主会话（统筹）** | T3 Code 中的 Opus 5.5 | 按依赖派发任务（`delegate_task`）、收交付报告、评审与合并、跑门禁、维护本文第 5 节进度表、在人工检查点停下来问用户 | 不自己写功能代码（评审中发现的小修正除外，且需在合并提交里写明）；不替用户做线上操作 |
| 子代理 · Codex | `delegate_task` → Codex | T0（部署，人在场）、T1（DB3b）、T2（ACP 驱动）、T4（配置页） | 碰 `workers/agent/loop/**`、HTTP 入口、Pi 驱动 |
| 子代理 · Opus | `delegate_task` → Opus（独立子会话） | T3a（Pi 驱动 + 运行时目录）、T3b（HTTP 入口 + chat-turn） | 碰 `supabase/`、`sense-console/` |
| 子代理 · Gemini | `delegate_task` → Gemini | T5（前端接真实接口 + 切路由）；交叉评审 Codex 的 T1、T2、T4 | 碰 `workers/`、`supabase/` |
| 用户 | 人 | 第 4 节的人工检查点 | — |

**分配理由**：Codex 一直负责数据库批次与发布流程，且本机 `codex-acp` 由它验证最直接；T3a / T3b 直接建立在 Opus 写的回合内核上，由 Opus 子会话延续改动最少；Gemini 写了全部 Chat UI 与 Pi spike。

**交叉评审**：每个代码分支合并前由**另一个模型**只读评审一次——T1、T2、T4 由 Gemini 评；T3a、T3b 由 Codex 评；T5 由 Opus 子会话评。评审提示词见第 6 节。

## 2. 派发顺序

| 波次 | 同时派发 | 触发条件 |
| --- | --- | --- |
| 1 | **T0**（Codex，需用户在场）、**T1**（Codex，另一 worktree）、**T2**（Codex 或第二个 Codex 子会话）、**T3a**（Opus）、**T4**（Codex，排在 T1 之后或并行，见下） | 立即 |
| 2 | **T3b**（Opus） | T1、T3a 已合并 |
| 3 | **T5**（Gemini） | T3b 已合并 |
| 4 | **T6**（主会话 + 用户） | T2、T4、T5 已合并 |

- 同一模型的多个任务可并行，但**每个任务一个 worktree**（见第 3 节），互不共享目录。
- T4 只依赖 T1 的列定义：可与 T1 并行，按任务书写类型；T1 合并后 rebase 再交付。
- 若 Codex 已在 T3 Code 之外按 [brief-codex-wave2.md](brief-codex-wave2.md) 执行，则 T0 / T1 / T2 / T4 视为进行中：主会话先收它的交付报告，不重复派发。

## 3. 分支与 worktree

所有分支从 `0.5.0` 最新提交切出（波次 2、3 从合并后的 `0.5.0` 切出）。

| 任务 | 分支 | worktree | 根 `package.json` |
| --- | --- | --- | --- |
| T0 | —（无代码） | `../sts-db` | — |
| T1 | `feat/db3b` | `../sts-db` | 不改 |
| T2 | `feat/acp-driver` | `../sts-acp` | 加 `@agentclientprotocol/sdk` |
| T3a | `feat/pi-driver` | `../sts-worker` | 加 `@earendil-works/pi-*@1.5.2` |
| T3b | `feat/http-entry` | `../sts-worker` | 不改 |
| T4 | `feat/config-pages` | `../sts-config` | 不改 |
| T5 | `feat/chat-ui-3` | `../sts-chat-ui` | 不改（`sense-console/package.json` 如需改须说明） |

- 子代理只在自己的分支提交；**不 push、不 merge、不 rebase 到别人的分支**。
- lockfile 冲突：合并时重新 `npm install` 生成，不手工合并。
- 合并顺序：T1 → T3a → T2 → T4 → T3b → T5（同一波次内按此顺序）。

## 4. 人工检查点（主会话必须停下来问用户）

1. **T0 开始前**：用户在场，提供部署方式 / 凭据；子代理在 Codex 终端里使用 `DATABASE_URL`，任何人都不打印连接串。
2. **T0 完成后**：用户在线上控制台走 README 第 5 批「执行后验收」5 项（会真实发布文章）。
3. **T6 第 1 步前**：用户批准执行 `0.5.0-step6.sql`。
4. **T6 第 2、3 步前**：用户决定 HTTP 节点的公网方式（隧道 / 云端），提供可用的模型 Key。
5. 任何子代理报告「需要改冻结约定」（DB3b 签名、chat.md 2.3 / 2.4、`driver.ts`）时：主会话先改文档并告知受影响的任务，再继续。

除此之外，主会话不等用户确认，按依赖自动派发下一项。

## 5. 主会话的收货流程（每个交付都走一遍）

1. **范围**：`git diff --name-only 0.5.0...<分支>` 只包含该任务允许的路径。
2. **密钥与禁用项**：对 diff 搜 `sk-`、`stn_`、个人路径、`service_role`、`@radix-ui`、`process.env`（`loop/` 内）、`child_process`（浏览器代码内）。
3. **门禁重跑**：在该 worktree 重跑任务涉及项目的全部门禁，不只信报告。
4. **交叉评审**：按第 1 节派给另一模型；属实的问题退回原子代理修复并要求每项附回归测试，主会话复核修复。
5. **试合并**：在临时 worktree 把分支合到最新 `0.5.0`，跑根目录 + `sense-console` + `sense-site` 全部门禁。
6. **合并**：`git merge --no-ff`，提交信息写明来源分支、执行模型与评审人；合并后在主 checkout 再跑一遍全部门禁。
7. **文档**：更新 [next-phase.md](next-phase.md) 第 1 节与下方进度表；涉及设计结论的写进 `docs/modules/chat.md`。

## 6. 派发提示词模板

主会话对每个任务用同一个模板，只替换方括号内容：

```text
你在 signal-to-story 仓库的 worktree [worktree]（分支 [分支]，从 0.5.0 的 [提交] 切出）中工作，任务是 docs/tasks/next-phase.md 的 [任务编号]。
先完整阅读：AGENTS.md、docs/architecture.md、docs/tasks/next-phase.md（[任务编号] 一节及其链接的规格）、docs/tasks/parallel-plan.md 第 3～5 节，
以及 [与任务相关的文档：如 docs/modules/chat.md 2.3～2.6、workers/agent/loop/chat/driver.ts]。

规则：只改 [任务编号] 列出的目录；不改冻结约定（DB3b 签名、chat.md 2.3/2.4、workers/agent/loop/chat/driver.ts），需要时写进报告；
不 push、不 merge；不在任何地方写密钥、连接串、项目 ID、令牌或个人路径；不做线上操作（T0 除外，且只在用户在场时）。
完成后跑 CLAUDE.md 规定的、该任务涉及项目的全部门禁，按 parallel-plan.md 第 5 节格式输出交付报告。
```

评审任务用：

```text
你在 signal-to-story 仓库的 [worktree] 中做只读评审，不修改文件、不提交。评审对象：git diff [基线]..[分支]（docs/tasks/next-phase.md 的 [任务编号]）。
按该任务的「内容 / 完成标准」与相关规格逐项核对，并主动构造反例（边界输入、并发、取消、超限、注入、权限绕过）。
输出：结论（可合并 / 修改后可合并 / 不可合并）、问题清单（严重程度、文件:行、问题、复现方式、建议改法）、待确认、逐项结果。只报能复现或能指到代码行的问题。
```

## 7. 进度表（主会话维护）

| 任务 | 执行 | 分支 | 状态 | 评审 | 合并提交 |
| --- | --- | --- | --- | --- | --- |
| T0 补部署 | Codex | — | 待派发（需用户在场） | — | — |
| T1 DB3b | Codex | `feat/db3b` | 待派发 | Gemini | — |
| T2 ACP 驱动 | Codex | `feat/acp-driver` | 待派发 | Gemini | — |
| T3a Pi 驱动 | Opus | `feat/pi-driver` | 待派发 | Codex | — |
| T3b HTTP 入口 | Opus | `feat/http-entry` | 等 T1、T3a | Codex | — |
| T4 配置页 | Codex | `feat/config-pages` | 待派发 | Gemini | — |
| T5 前端切换 | Gemini | `feat/chat-ui-3` | 等 T3b | Opus | — |
| T6 上线 | 主会话 + 用户 | — | 等 T2、T4、T5 | — | — |
