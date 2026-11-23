
T3 Code 的 ACP（Agent Client Protocol）方案，本质上是一套标准化的“多 Agent 统一接入与编排协议”。T3 Code 自己不提供大模型，而是作为统一控制面板，通过原生适配 + ACP 协议双轨机制，把本机已安装的各类 Coding Agent 收拢到一个界面里调度。

1. 核心架构与双轨定位

T3 Code 将外部 Coding Agent 分为两类接入方式：
• 原生内置 Provider。针对 Codex、Claude Code、Cursor、Grok、OpenCode、Pi、Antigravity 等主流工具，T3 Code 官方文档 提供深度内置适配，直接在 Settings → Providers 开启即可，不会出现在 ACP 列表中。
• ACP 标准生态接入。只要符合 ACP 协议的工具（如 Qwen Code、Qoder CLI、Amp、Cline、Copilot、goose 等），均可通过官方 ACP Registry 一键添加，或手动配置本地 ACP 命令行接入。

2. 协议兼容与功能支持

• v1 / v2 协议协商。优先使用 ACP v2 预览协议，支持更丰富的消息流、Token 用量统计、执行计划（Plans）、上下文压缩（Compaction）以及终端状态同步；对于尚未升级的旧工具，会自动向下兼容协商 ACP v1。
• BYOS（自带订阅）模式。ACP Agent 自带模型、工具链和登录态（走你本机的 OAuth 或 API Key），T3 Code 仅负责提供项目管理、线程控制、检查点（Checkpoints）和权限审批。

3. 底层运行与跨 Agent 编排机制

• 轻量级子进程调用。T3 Code 不会用耗费资源的 GUI 模拟点击去操作外部软件，而是由本地核心引擎在后台直接拉起对应的 CLI 子进程，通过标准输入输出/协议流交互，轻量且稳定。
• 内部 /mcp 跨模型委派。T3 Code 向上层运行的 Agent 暴露了一套内部 /mcp 端点。主线程（例如 Codex）在执行复杂任务时，可以直接通过工具调用拉起其他 ACP Agent（例如让 Qwen 修 Bug、DeepSeek 做测试）作为独立子线程协同工作。
• Git Worktree 物理隔离。多个 ACP 子线程并发修改同一个代码库时，系统会为每个线程自动分配独立的 Git Worktree 和分支，避免文件相互覆盖，并在右侧面板集成 Diff 审阅与 PR 工作流。