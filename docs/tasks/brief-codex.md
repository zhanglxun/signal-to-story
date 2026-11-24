# 任务简报 · Codex · 第一波：阶段 0 + DB3b

> 2026-11-24 · 分工与合并规则见 [parallel-plan.md](parallel-plan.md)。你的分支 `feat/db3b`，worktree `../sts-db`。合并、验收由 Claude 负责。

## 启动提示词（用户整段发给 Codex）

```text
你在 signal-to-story 仓库的 worktree ../sts-db（分支 feat/db3b，从 0.5.0 切出）中工作。
先完整阅读：AGENTS.md、docs/architecture.md、docs/database.md（第 8 节与 DB-D14/DB-D17）、
docs/tasks/parallel-plan.md、docs/tasks/brief-codex.md（本简报）、docs/tasks/db3b-chat-runtime-catalog.md、
docs/modules/chat.md 第 2.3～2.6 节与第 5 节。

按 brief-codex.md 的顺序执行：任务 A（阶段 0：执行最终批次 step5 并部署）→ 任务 B（DB3b 迁移、测试与 step6 生成）。
任务 A 严格按 supabase/release/0.5.0-step5-codex-prompt.md 与 supabase/release/README.md 执行，每个停止条件都要遵守；
任务 A 中任何一步不符合预期就停止并汇报，不要继续任务 B 的线上部分（任务 B 本身只在仓库和 PGlite 里进行，不上线）。

硬性规则：
- 只改 parallel-plan.md 第 3 节分配给你的目录；其他目录只读。不改根目录 package.json / lockfile。
- 只在 feat/db3b 上提交；不 push、不 merge、不 rebase 到其他分支。
- 不在任何输出、日志、提交、文档里写密钥、连接串、项目 ID、节点令牌、个人路径。
- 不执行 step6（DB3b）上线；它由用户另行决定。
- 简报与冻结约定有冲突或你认为设计有误时，不要自行改设计，在交付报告「偏差与理由」里写明并按最保守的方式实现，或停下询问。

完成后按 parallel-plan.md 第 5 节格式输出交付报告。
```

## 任务 A：阶段 0 —— 执行最终批次并部署（线上操作）

- 依据：[../../supabase/release/0.5.0-step5-codex-prompt.md](../../supabase/release/0.5.0-step5-codex-prompt.md)（步骤 0～8 与全部停止条件）。
- 前提：用户已勾完该文件里的「执行前清单」。**用户没有明确说「开始执行 step5」之前，只做步骤 0（本地门禁）并汇报。**
- 交付：该提示词要求的汇报表（预检 / 核对 SQL 原始输出、`backfill_v1 (final)` 通知、部署与 worker 重启情况）。
- 任务 A 不产生代码提交。

## 任务 B：DB3b —— 迁移、测试与 step6（只在仓库和 PGlite）

**规格以 [db3b-chat-runtime-catalog.md](db3b-chat-runtime-catalog.md) 为准**（含「需求 0」与第 3 节已给出的结论）。实现要点与验收标准：

1. **新迁移** `supabase/migrations/20261127100000_chat_runtime_catalog.sql`，覆盖需求 0～5 的全部条目：
   - 需求 0：`reply_to_message_id`、助手消息按任务部分唯一 + 幂等返回、同会话单活跃回合、`chat_turn` 的 `max_attempts = 1` 与可配置 `max_rounds`（默认 8、上限 20）、`budget_cents` 默认 50 且夹紧 1～500、`node_append_chat_message` 的 `p_finish`（追加 + 完成同事务）。
   - 需求 1～4：`parts` / `status`、`runtime_config` 与列级 update 授权、`send_chat_message` 扩展、`regenerate_chat_turn`、`node_chat_context`（按 payload `message_id` 截断、同组多版本只取最新 `completed`）、`node_append_chat_message` 的 `p_parts / p_status / p_title`。
   - 需求 5：`capabilities` / `capabilities_updated_at` 与列级 select 授权、`node_report_capabilities`（精确键名检查、`runtimes ≤ 64`、`id` 格式）、`node_claim` 的 `target_node_id` 过滤、**`node_claim_job`**、未认领 `chat_turn` 10 分钟过期清理（`chat_turn_unclaimed`）。
   - 扩展签名的函数**先 `drop` 旧签名再建新签名**，并重新 `revoke/grant`，保证 PostgREST 不出现重载歧义。
   - 所有新函数 `security definer set search_path=''`，`node_*` 授权方式与现有 `node_*` 一致。
2. **测试**：新增 `supabase/tests/db/chat-runtime-catalog-db.test.ts`（PGlite），至少覆盖任务书第 4 节 1～4 条的全部用例；现有测试全部保持通过（必要时只改因签名变化而失效的调用，并在报告中列出）。
3. **step6**：在 `testing/db/release.ts` 增加 `step6` 批次（只含本迁移，生成 `supabase/release/0.5.0-step6.sql`），前置检查为「迁移历史最后一条是 `20261126100300`」；新增 `testing/db/release-step6.test.ts` 演练；**step1～5 必须逐字节不变**（release 测试会校验）。在 `supabase/release/README.md` 批次状态表加一行「第 6 批：已生成，待决定上线时间」，并按已有批次的格式写执行步骤与核对 SQL。
4. **schema 快照**：按仓库现有流程更新 `testing/db/schema-snapshot` 相关产物，使快照测试通过。
5. **门禁**（全部通过才算完成）：

   ```bash
   npm install && npm run typecheck && npm run lint && npm test
   npx tsx testing/db/release.ts && git diff --exit-code supabase/release/0.5.0-step{1,2,3,4,5}.sql
   ```

6. **不做**：不改 `workers/`、`sense-console/`、`sense-site/`；不改 `docs/database.md` / `docs/status.md`（把建议改法写进交付报告）；不上线 step6。

## 第二波预告（等 Claude 通知再开始）

`AgentSessionDriver` 接口合并后：`workers/agent/drivers/acp-driver.ts`（R3.4，先 `opencode` 再 `codex-acp`）与 R3.5（Vite 桥退役、模型 / CLI 配置页改读 `capabilities`）。届时另发简报。
