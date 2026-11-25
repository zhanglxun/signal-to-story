# Agent 工程研究结论

> 由 `docs-site/research/`（2026-11-05 第二版，10 篇来源笔记 + 2 篇分析）精简而来。原始笔记在 `codex/0.3` 的 git 历史中。这里只保留对本项目仍然有效的结论。

## 1. 核心判断

Agent 的瓶颈已经从模型能力转向外围系统：**触发、授权、状态、验证，以及人的注意力**。DeepSeek super-agent、卡兹克 Agent-Autoloop、Anthropic 长任务 harness 三个独立来源都指向这个判断。但这些材料几乎都来自写代码的场景，迁移到内容生产后是否有效，目前没有证据。

## 2. 已采纳的机制

| 机制 | 来源 | 在本项目中的落点 |
| --- | --- | --- |
| 列清「必须问人」的类别（发布、花钱、改权限、删数据、对外发消息） | 卡兹克 | `approval_requests` + 数据库触发器 |
| 决定记忆：记住人做过的决定和明确不做的事 | 卡兹克 | `decision_memories`，注入 Context Pack |
| 循环有上限：轮次、跳数、预算 | 卡兹克、0xwhrrari | `max_rounds ≤ 3`、`max_hops`、`budget_cents` |
| 指令和数据分离 | 卡兹克、DeepSeek | `<untrusted_source_data>` 标签 |
| 生成者和评估者分离，评估者只读、最好用不同厂商的模型 | Anthropic、卡兹克 | 确定性预检 + 独立 LLM 评估 |
| 能用确定性代码就不叫醒模型 | DeepSeek Fast Path、Autoloop | 去重、白名单、预检都用规则 |
| 挂起零消耗：等人期间不占进程、不花 token | Autoloop | `pending_review` 时 worker 退出该任务 |
| 界面以「等我处理」为中心 | DeepSeek 面板 | 任务看板的「等我处理」列 |
| 主动行为先用影子模式，只记录不执行 | DeepSeek | 定时发现选题只写推断类 trigger |

## 3. 不采纳

- **用 LLM 做路由、多级 Router/Worker 会话**：单人规模下，规则路由更便宜、更容易审计。
- **Agent 无审批地执行命令、云和端点互信**：DeepSeek 作者自己也把它列为未解决的安全问题。
- **用模型判断 worker 是否偏离目标（Watchdog）**：成本高，而且没有可靠依据。
- **自动发布、自动合并**：与人工放行原则冲突。

## 4. 仍然开放的问题

1. 「内容合格」的评估清单由谁定义、怎么校准？这是从代码场景迁移过来时唯一没有现成答案的部分。目前以 [product.md](product.md) 的四道门禁为准。
2. 发布数据怎样回灌到选题判断？所有来源在这一点上都很弱。
3. 所有来源给出的数字都是作者自报，没有独立验证。

## 5. 来源清单

DeepSeek super-agent 原型仓库与长文；卡兹克《Agent 自动化系统》两篇与 Agent-Autoloop README；Anthropic《长任务 harness》《Planner-Generator-Evaluator》；Claude Code review 流水线；Claude Agent SDK 循环；Google 行为级 eval；0xwhrrari《Harness Engineering》。尚未读到原文：吴恩达课程、OpenAI 三篇。
