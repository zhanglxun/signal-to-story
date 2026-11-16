# DeepSeek dsh-superagent 原型

- 来源:https://github.com/deepseek-ai/dsh-superagent-prototype (MIT)
- 配套文章:*Exploring Super-agent Design: Towards a More Autonomous Agent System*(X 帖 https://x.com/DeepSeekHarness/status/2116857257245987236,**未核实**,抓取失败)
- 抓取日期:2026-11-05
- 核实状态:**已核实仓库 README、`docs/000-philosophy.md`、`001-domain.md`、`003-execution.md`**;未读 002 授权、004 提示词、005 面板、006 部署、007 架构、008 Cookbook。

## 它是什么

面向**单个 GitHub 仓库**的主动式 coding agent,打包为 DeepSeek Harness 的 bundle。监听 GitHub 与可选的飞书;被允许的人提出请求后,开一个工作单,在独立会话和独立目录里工作,在原对话里回复(例如提交 PR)。网页面板只展示需要人处理的事项。

作者声明:这是研究原型,"仅供参考,非官方产品",与文章中的内部实现不完全一致,文章里的部分设计是未来方向,原型未实现。大量工程由 coding agent 完成。

## 核心哲学(000)

> 占用尽可能少的人类注意力,给出尽可能多的价值。

- 只在被请求,或有团队书面规则允许时行动;主动工作先以"仅记录"模式启动。
- 只在人必须行动或能使用结果时发言;一次只问一个具体问题。
- 按影响而非工作量决定何时停下;如实报告,草稿标未完成,失败标失败。
- 设计上:概念少、设置少、面板只显示需要人处理的内容;噪声大时缩短提示词,不要增加解释性消息。
- 起步建议:白名单要短,主动工作先只记录,看"它本会做什么"合理后再放宽。

## 领域模型(001)

流程:`Source → Trigger → Thread → Eval → (Ticket + Mandate) → Assignment → Executor → Channel 回写`

| 概念 | 要点 |
| --- | --- |
| Source | 事件流;持有读取位置,过滤机器人自己的消息;重启不重放 |
| Trigger | 不可变事件;同一 Trigger 接受两次只产生一个 Ticket(幂等) |
| Thread | 按时间排序的 Trigger;同一时刻最多一个 Eval |
| Eval | 无状态判断:输入 Trigger 批次 + Thread 快照 + 现有 Ticket + 当前 Policy;输出 Decision |
| Mandate | 授权凭证:Policy 版本、范围、强度、命中规则、发送者身份;**不可变**,范围变大必须新建 Ticket |
| Ticket | 一个被授权的工作单元;只有 Eval 能创建;自己定义状态,不跟随 Executor |
| Assignment | Ticket 与 Executor 实例的绑定,一个 Ticket 可先后有多个 |
| Subscription | Ticket 与 Thread 多对多;后续讨论自动到达 Executor,无需再次 @ |
| Policy | 版本化的评估规则和各 Source 的白名单;规则变化时丢弃运行中的 Eval,但不撤销已有 Mandate |

明确**拒绝**的设计(值得参考):不建 Principal/成员实体、不做跨 Source 身份映射、Eval 不自己安排延迟触发、Policy 变化时不取消在途工作(只记录并送达)、不从自由文本推断"等待人"(要求结构化字段)。

## 执行(003)

- Ticket 阶段由"在等什么"决定,首个匹配行生效:输入未送达 / 待回答 / 待审阅(Report=`ready`) / 阻塞或失败 / 排队 / 空闲 / 工作中。凡是 `person` 阶段都表示"无人输入就不能继续"。
- 每个 Ticket 一个 Executor 会话 + 一个目录(典型用 `git worktree`);并发有上限,另留 1 个额外槽位给"人的消息",保证新工作不能挤掉人的介入。
- 后台任务在每轮结束后最多 30 分钟;移交给人时立即释放槽位。
- 执行环境默认**不经审批运行命令**,以操作者的 OS 用户身份运行;文档明确"这只是默认值,不是安全边界"。
- 合并:默认不允许 agent 账号开启自动合并;默认指令仅在"为该 Ticket 开的 PR、已就绪、审批覆盖头提交、改动小于 200 行"时才允许;强制审批应在分支保护中配置。
- 结束方式:`ready`(无 PR)、`dropped`(无事可做,静默结束)、跟随 PR 直到合并/关闭;人的后续消息可恢复,除非人明确停止。

## 备注

- 与本项目最相关的是:**授权与执行分离**(Mandate)、**事件幂等**、**以"待人处理"为中心的面板**、**静默默认**。
- 与本项目边界冲突的是:Executor 在宿主机上无审批执行命令,这与我们"Console 不跑长任务、Agent 只提 Proposal"的边界不同,见 [01-对Signal-to-Story的启示.md](../01-对Signal-to-Story的启示.md)。
