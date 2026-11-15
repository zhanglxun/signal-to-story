# 研究归档:Agent 自循环 / Harness 工程

> **归档状态（2026-11-15）**：本目录的核心研究结论（指令数据分离、Generator ↔ Evaluator ≤3 轮自循环、决定记忆 Decision Memory、Mandate 数据库强制门禁、挂起零消耗、规则前置过滤）已正式采纳并落地于 [V2.0 统一架构规划](../plan/v2-unified-architecture-plan.md)、[V2.0 实施总计划](../plan/v2-master-execution-plan.md)（P1 / P1.5 / P6a）及 [Agent Harness 内核文档](../../sense-console/docs/agent-harness.md)。本目录保留作为理论溯源归档。
>
> 建立日期:2026-11-05(第二版,已纳入用户 Notion 页附件)。本目录归档"Agent 进入自循环、持续工作阶段"方向的外部资料与分析,供后续改进 Signal to Story 的 Agent 工程方案时引用。
> 这里是**研究输入**,不是决策。进入 SPEC 或 plan 之前,需要人工确认。

## 目录

| 文件 | 内容 |
| --- | --- |
| [00-综合判断.md](00-综合判断.md) | 来源之间的关系、共同模式、真实分歧、证据质量、缺口 |
| [01-对Signal-to-Story的启示.md](01-对Signal-to-Story的启示.md) | 与本项目现状对照、可借鉴点(含代价)、暂不借鉴、待决问题 |
| [sources/01-dsh-superagent.md](sources/01-dsh-superagent.md) | DeepSeek 原型仓库(README、哲学、领域模型、执行) |
| [sources/07-deepseek-super-agent设计探索.md](sources/07-deepseek-super-agent设计探索.md) | DeepSeek 长文全文要点,含实验与开放问题 |
| [sources/08-卡兹克-agent自动化系统与autoloop.md](sources/08-卡兹克-agent自动化系统与autoloop.md) | 卡兹克两篇长文 + Agent-Autoloop README |
| [sources/09-harness-engineering长文-0xwhrrari.md](sources/09-harness-engineering长文-0xwhrrari.md) | 七项职责与检查清单(个人综述) |
| [sources/02-anthropic-长任务harness.md](sources/02-anthropic-长任务harness.md) | Initializer + Coding agent、`feature_list.json` |
| [sources/03-anthropic-planner-generator-evaluator.md](sources/03-anthropic-planner-generator-evaluator.md) | 三角色 harness、sprint 合同 |
| [sources/04-claude-code-review流水线.md](sources/04-claude-code-review流水线.md) | 多 agent 审查、投票、按风险分级审批 |
| [sources/05-claude-agent-sdk-循环.md](sources/05-claude-agent-sdk-循环.md) | gather → act → verify → repeat |
| [sources/06-google-行为级eval.md](sources/06-google-行为级eval.md) | 行为级 eval |
| [sources/99-未核实线索.md](sources/99-未核实线索.md) | 仍未读到原文的来源(吴恩达视频、OpenAI 三篇、若干 X 帖等) |

## 来源取得方式与核实状态

| 来源类别 | 取得方式 | 状态 |
| --- | --- | --- |
| Anthropic / Google 官方文章 | 我直接抓取,读到的是网页抓取**摘要** | 已核实(摘要级) |
| DeepSeek 原型仓库 | 我直接从 raw.githubusercontent.com 读取 | 已核实(部分文档) |
| DeepSeek 长文、卡兹克长文、0xwhrrari 长文 | 用户 Notion 页附件,由 Grok bot 经 X API 抓取;DeepSeek 为机翻英文 | 已读(附件版本;**未与 X 原页逐字比对**) |
| agent-autoloop 仓库 | 我直接读取 README | 已核实(仅 README) |
| 吴恩达视频、OpenAI 三篇、其余 X 帖 | 无法取得原文 | **未核实** |

## 相关性排序(对本项目)

1. **卡兹克 / Agent-Autoloop**:最具体、最小、最可移植的防失控机制(必须问人的清单、决定记忆、跳数熔断、指令数据分离、审查者只读)。
2. **DeepSeek 长文 + 原型**:Source→Trigger→Eval→Ticket→Mandate 的领域模型,"少占注意力"的哲学,以及自己承认的安全开放问题。
3. **Claude Code 审查流水线**:按风险分级的人类审批。
4. **Anthropic 长任务 harness 两篇**:跨会话状态制品、独立评估者。
5. **Agent SDK / Google eval / 0xwhrrari**:验证方法与检查清单。

## 维护约定

- 新增资料放入 `sources/`,文件头写明来源 URL、取得方式、读取日期和核实状态。
- 引用原文限于短句;其余用自己的话概括。
- 作者自报的数字必须标注"自报"。
- 结论性内容只写进 `00` 和 `01`,单篇笔记只记事实与要点。
