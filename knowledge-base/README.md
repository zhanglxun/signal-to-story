# 星火工厂 · 项目内建知识库 (Knowledge Base)

本目录是 **星火工厂（Signal to Story）** 的受控项目知识库存储区，用于在**完全不依赖 Obsidian 桌面端**的前提下，沉淀创作 SOP、品牌语调、领域背景事实与人工决策记忆（Decision Memories）。

## 目录结构

```text
knowledge-base/
├── sops/                   # 图文与视频分镜标准作业流程 (SOP)
├── brand-voice/            # 栏目定位、受众画像、文风与禁用词规范
├── domain-facts/           # 经核实的行业背景与常青知识卡片
└── decision-memories/      # 人类审核拍板沉淀的长期规则导出归档
```

## 使用方式

1. **服务端与控制台直接挂载**：`sense-console` 的 `knowledge-base-service` 可直接解析标准 Markdown（含 YAML Frontmatter），按标签或分类自动注入到 **Sense Agent Harness** 的 `<project_knowledge_base>` 上下文块中。
2. **标准 Markdown 导入/导出**：支持将任意外部 `.md` 文档导入平台知识库或草稿箱（自动清理 Obsidian 私有语法与不安全脚本），也可将平台定稿导出到此目录归档。
