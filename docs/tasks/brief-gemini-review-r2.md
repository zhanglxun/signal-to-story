# 任务简报 · Gemini 4 · 交叉评审：R2 与 R3 回合内核（只读）

> 2026-11-24 · 原计划由 Codex 评审 Claude 的分支（[parallel-plan.md](parallel-plan.md) 第 1 节），Codex 正在执行 step5 与 DB3b，改由 Gemini 评审。**只读评审，不改代码、不提交。**

## 启动提示词（用户整段发给 Gemini）

```text
你在 signal-to-story 仓库的 worktree ../sts-chat-ui 中工作。本次是只读代码评审：不修改任何文件、不提交、不切换别人的分支，
用 git 命令直接读取分支内容即可（例如 git diff、git show feat/r3-core:<路径>）。

先阅读：docs/tasks/brief-gemini-review-r2.md（本简报）、docs/architecture.md 第 4 节与 6.2 节、
docs/modules/chat.md 第 2.3～2.6 节与 3.2 节、docs/tasks/r1-to-r3-plan.md 阶段 1。

评审对象（均在 feat/r3-core 上，基线是 9774d19）：
  git log --oneline 9774d19..feat/r3-core
  git diff 9774d19..feat/r3-core

按简报的检查清单逐项评审，输出简报「输出格式」要求的评审报告。只报告你确认存在的问题，并给出能复现或能指到代码行的依据；
拿不准的单独列在「待确认」里，不要混进问题清单。
```

## 评审范围

| 提交 | 内容 |
| --- | --- |
| `59c2b1c` | R2：`sense-console/src/harness/*` 迁入 `workers/agent/loop/`；worker 侧契约副本 `loop/contracts/`；控制台展示元数据 `src/config/agent-runtimes.ts`；删除 `agent-harness-service.ts` 与旧 Chat 页的浏览器内循环；ESLint 边界规则 |
| `04df932` | 修复 `loop/` 边界规则：任意层级拦截 drivers / entry 等，内置模块改用精确路径 |
| `788514f` + `4223244` | `workers/agent/loop/chat/`：`AgentSessionDriver` 接口、事件与 parts 类型、上下文截断、单轮预算、parts 累积器、工具白名单、`runChatTurn`、假驱动与 16 个单测 |

## 检查清单

**R2（结构迁移）**
1. `workers/**` 是否还有任何对 `sense-console/**` 的引用（含测试、demo、Dockerfile、tsconfig）。
2. `loop/contracts/` 副本与控制台原文件在**被 worker 使用的部分**是否一致（`agent-job` 的 `readJobLimits` / `summarizeJobUsage` / `mapAgentJobStep`，`video-studio` 的 `VideoPlanDraftSchema` / `checkStoryboardSop`），有无复制时漏掉的依赖或改变行为。
3. 删除的测试是否都有去处：`sense-console/src/test/agent-harness.test.ts` 拆成了控制台展示元数据测试与 `workers/agent/loop/runtime-providers.test.ts`；`runGeneratorEvaluatorLoop` 测试随函数删除——确认 worker 侧对 `runHarnessJob` 仍有等价覆盖。
4. 旧 Chat 页删掉「自循环出稿」后，另外两个模式的行为是否保持不变（只看 diff 有无误删）。
5. ESLint 规则：能否构造出一个**能通过 lint 的**违规引用（例如别名、动态 `import()`、`require`、`export ... from`）。

**R3 回合内核**
6. `driver.ts` 的约定是否足以让 Pi（`agentLoop`，见 `docs/tasks/pi-spike-result.md`）与 ACP（`session/prompt`、`session/update`、`session/request_permission`、`session/cancel`）两种驱动都实现，不需要改接口；指出缺的字段或回调。
7. `run-turn.ts`：取消、浏览器断开、驱动抛错、预算耗尽、权限超时五条路径是否都**只落库一次**且一定发出 `done`；有无未处理的 Promise 拒绝；`recordUsage` 失败是否会卡住回合。
8. `context.ts`：截断后估算是否一定不超过 `inputBudget`；`truncateMiddle` 在极小预算、空串、全 ASCII / 全 CJK 时是否正确；引用资料的转义是否能被 `label` 绕过。
9. `accumulator.ts`：超大 parts 收缩后是否一定 ≤ 250 000 字节（构造反例）；`content` 是否永远非空且 ≤ 200 000 字。
10. 事件与 parts 类型和 `docs/modules/chat.md` 2.3（含「字段取值」段）是否逐字段一致；和已合并的 `sense-console/src/modules/chat/types.ts` 是否一致。

## 输出格式

```text
## 评审报告：feat/r3-core（R2 + R3 内核）· 评审人 Gemini
结论：可合并 / 修改后可合并 / 不可合并

### 问题清单（按严重程度排序）
| # | 严重程度（阻塞/重要/建议） | 文件:行 | 问题 | 依据或复现方式 | 建议改法 |

### 待确认
- …

### 检查清单逐项结果
1～10 各一行：通过 / 有问题（对应问题编号）
```
