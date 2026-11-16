# Google:The Anatomy of Harness Engineering(行为级 eval)

- 来源:https://developers.googleblog.com/en/the-anatomy-of-harness-engineering-how-to-evaluate-iterate-and-guard-ai-coding-agents/
- 抓取日期:2026-11-05
- 核实状态:已核实(通过抓取摘要)

## 要点

- 端到端基准只给综合分,解释不了**为什么**变了。行为级 eval 检查离散、可观察的动作:是否在不确定时提问而非猜测、结束前是否运行了校验器、是否对实时数据使用了搜索。类似 harness 的集成测试。
- 时机:早期不做正式 eval,靠开发者直觉和自用;等 agent 能处理自己的代码库后再加,用来保证前进并抓回归。
- 架构:断言要快、确定、本地;检查中间步骤(工具调用、文件改动),不比对完整输出文本。
- 迭代:从**一种**失败模式开始。单一路径的简单任务用严格断言;复杂任务用基于结果的检查(如 LLM 评委),因为 agent 可能走合法但意外的路径。提示调整可自动化,直到失败用例通过。
- 护栏:输出不确定,所以**批量跑并追踪聚合通过率**,不因单次噪声阻断 PR。
- 定位:不取代端到端基准——基准验证最终结果,行为级 eval 让迭代安全而快速。
