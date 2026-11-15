# Anthropic:Effective harnesses for long-running agents

- 来源:https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- 抓取日期:2026-11-05
- 核实状态:已核实(通过抓取摘要,非逐字阅读全文)

## 问题

每个 session 开始时没有此前工作的记忆,上下文窗口有限;仅靠压缩(compaction)不足以从一句高层提示得到可上线质量的产物。

## 方案:两类 agent + 跨 session 制品

**Initializer agent(仅首个 session)**创建:
- `init.sh`:启动开发服务;
- `claude-progress.txt`:agent 活动日志;
- 一次初始 git commit;
- 把用户提示展开成**功能清单**。

**Coding agent(之后每个 session)**:一次只做一个功能,结束时留下干净、可合并的状态,写清晰的 commit 并更新进度文件。

**`feature_list.json`**:200 多条端到端功能,初始全部 failing;每条含类别、描述、测试步骤、`passes`。agent 只能改 `passes`,文中强调"删除或编辑测试是不可接受的";选 JSON 而非 Markdown,是因为模型更不容易覆盖它。

**Session 启动例程**:确认工作目录 → 读进度文件和 git log → 读功能清单 → 运行 `init.sh` → 跑一遍基础端到端测试,再开始新工作(先发现上一个 session 留下的 bug)。

**测试**:用浏览器自动化(Puppeteer MCP)像用户一样端到端验证,而不是只做单元测试或 curl。已知局限:看不到浏览器原生弹窗。

## 失败模式与对策

| 失败模式 | 对策 |
| --- | --- |
| 试图一次做完导致上下文耗尽 | 功能清单 + 每次一个功能 |
| 环境遗留 bug 或无文档 | git 提交 + 进度笔记;session 开始先跑基础测试 |
| 过早宣布完成 | 清单初始全 failing,测试通过才改状态 |
| 未做端到端验证就标记完成 | 浏览器测试提示 |
| 浪费时间摸索怎么启动 | `init.sh` |

## 开放问题(原文)

专门化 agent(测试、QA、清理)是否优于单一通用 coding agent;这套做法能否推广到全栈 Web 之外。
