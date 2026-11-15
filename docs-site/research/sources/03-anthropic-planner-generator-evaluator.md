# Anthropic:Harness design for long-running application development

- 来源:https://www.anthropic.com/engineering/harness-design-long-running-apps
- 抓取日期:2026-11-05
- 核实状态:已核实(通过抓取摘要)

## 三个角色

- **Planner**:把 1–4 句提示展开成产品规格;技术细节保持高层,避免早期规格错误向下传导。
- **Generator**:按 sprint 一次实现一个功能,使用 git;每个 sprint 先自检再交 QA。
- **Evaluator**:用 Playwright 像用户一样点击运行中的应用,检查 UI、API 与数据库状态;每条标准有硬阈值,任一不达标则 sprint 失败。

## Sprint 合同

编码前,generator 先提出"要做什么、如何验证";evaluator 审阅,双方迭代到一致。合同很细(某个关卡编辑器 sprint 有 27 条标准)。两者通过**文件**通信,让工作贴合规格而不过早约束实现。

## 结果(原文数字)

- 单 agent:约 20 分钟、$9,核心功能无响应。
- 完整 harness:约 6 小时、$200,可玩,物理效果粗糙。
- 另一个 DAW 实验:约 4 小时、$124.70,QA 仍发现被"桩化"的功能(录音不工作、缺少片段编辑)。

## 经验

1. **做事的和评判的要分开**:agent 评自己的活会宽松;独立 evaluator 更容易调教得严格。开箱的 evaluator 也会放行有缺陷的工作,需要依据日志反复调整提示。
2. 前端实验用四条标准(设计质量、原创性、工艺、功能),前两项加权以对抗"千篇一律";用少量示例校准评估者,运行 5–15 轮。
3. **每个组件都编码了"模型自己做不到什么"的假设**,这些假设会随模型升级过期。原则:"找到尽可能简单的方案,只在需要时增加复杂度"。
4. 上下文重置对 Sonnet 4.5 的"上下文焦虑"有用,Opus 4.5 基本不再需要;换到 Opus 4.6 后 sprint 结构被移除,evaluator 改为末尾单次评估。
5. Evaluator 只在任务超出模型单独可靠完成的范围时才值回成本。每次换新模型都要重新审视 harness:删掉不再贡献的部分,加上新可行的能力。
