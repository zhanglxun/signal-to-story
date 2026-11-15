// Built-in sample snapshots for local demo mode only (VITE_SITE_DEMO=1 or no Supabase configured).
// Every page shows a visible "演示数据" badge while these are in use. These are illustrative
// samples, not real published content, metrics or authors.
import type {
  SiteCategory,
  SiteEntry,
  SiteEntryBody,
  SiteInfo,
  SiteResource,
  SiteTopic,
} from "@/contracts/site"

export const demoSite: SiteInfo = {
  id: "demo-site",
  slug: "signal-to-story",
  name: "星火工厂 · Signal to Story",
  description: "企业 AI 实战、AI 知识科普、工具与工作流、故事与创意。以下为本地演示快照。",
  base_url: "",
}

export const demoCategories: SiteCategory[] = [
  { id: "cat-enterprise", slug: "enterprise-ai", name: "企业 AI 实战", description: "真实业务里的 AI 落地方法与复盘。", sort_order: 10 },
  { id: "cat-basics", slug: "ai-basics", name: "AI 知识科普", description: "把概念讲清楚，不夸大，不神化。", sort_order: 20 },
  { id: "cat-workflow", slug: "tools-workflow", name: "工具与工作流", description: "可复用的工具组合与操作步骤。", sort_order: 30 },
  { id: "cat-story", slug: "story-creative", name: "故事与创意", description: "用故事解释技术与人的关系。", sort_order: 40 },
  // Enabled but without published entries: must not take a homepage slot.
  { id: "cat-empty", slug: "empty-category", name: "暂无内容的分类", description: "", sort_order: 50 },
]

type DemoEntry = SiteEntry & { status: "online" | "offline"; body: SiteEntryBody }

const day = (n: number) => new Date(Date.UTC(2026, 10, 14 - n, 2, 0, 0)).toISOString()

function entry(partial: Omit<DemoEntry, "current_release_id" | "current_version" | "updated_at" | "cover_url" | "cover_alt"> & Partial<DemoEntry>): DemoEntry {
  return {
    current_release_id: `rel-${partial.id}`,
    current_version: 1,
    updated_at: partial.published_at,
    cover_url: "",
    cover_alt: "",
    ...partial,
  }
}

export const demoEntries: DemoEntry[] = [
  entry({
    id: "e-agent-failures",
    slug: "why-enterprise-agents-stall",
    title: "企业 AI Agent 落地卡住的三个真实原因",
    summary: "不是模型不够强，而是任务边界、数据权限和人工门禁没有设计清楚。本文拆解三个常见卡点与对应的最小改法。",
    category_id: "cat-enterprise",
    format: "article",
    column_key: "analysis",
    access_level: "public",
    published_at: day(0),
    status: "online",
    body: {
      markdown: `## 一、任务边界没有写成可验收的结果

很多团队把“让 Agent 帮忙处理工单”当成需求，但没有回答：处理到哪一步算完成？谁来验收？

**最小改法**：把任务写成“输入 → 输出 → 验收人”三元组，先只覆盖一种工单类型。

## 二、数据权限按人给，而不是按任务给

Agent 继承了操作员的全部权限，一旦出错影响面很大。

- 为每类任务准备最小上下文包（Context Pack）
- 敏感字段在服务端过滤，而不是靠提示词约束

## 三、没有人工门禁

> 发布、付款、删除这类不可逆操作，必须由人确认。

Agent 产出的是**提案**，不是结论。把“批准”按钮留给人，系统才敢放心地自动化前面的步骤。

## 小结

先验证一条真实链路，再增加抽象。参考：[Supabase RLS 指南](https://supabase.com/docs/guides/database/postgres/row-level-security)。`,
      media: [],
      source_refs: [{ title: "Supabase Row Level Security", url: "https://supabase.com/docs/guides/database/postgres/row-level-security" }],
    },
  }),
  entry({
    id: "e-rag-basics",
    slug: "rag-in-plain-words",
    title: "用一张表讲清楚 RAG：检索增强生成到底增强了什么",
    summary: "RAG 不是让模型“记住”你的资料，而是在回答前先查资料。本文用对比表解释它能解决和不能解决的问题。",
    category_id: "cat-basics",
    format: "tutorial",
    column_key: "how_to",
    access_level: "public",
    published_at: day(1),
    status: "online",
    body: {
      markdown: `## RAG 做了什么

1. 把问题转成检索请求
2. 从资料库取回相关片段
3. 把片段和问题一起交给模型

## 能解决与不能解决

| 场景 | RAG 是否有帮助 |
| --- | --- |
| 资料经常更新 | 有帮助 |
| 需要引用出处 | 有帮助 |
| 资料本身是错的 | 无法纠正 |
| 需要复杂推理 | 帮助有限 |

## 一个最小实验

\`\`\`text
问题：我们的报销上限是多少？
检索：取回《差旅制度 v3》第 2 节
回答：附带出处链接
\`\`\`
`,
      media: [],
      source_refs: [],
    },
  }),
  entry({
    id: "e-workflow-video",
    slug: "three-minute-content-pipeline",
    title: "三分钟看懂：从一条线索到一篇待审稿件",
    summary: "演示视频：线索收录、选题立项、AI 草案与人工审核如何串成一条可追溯的流水线。",
    category_id: "cat-workflow",
    format: "video",
    column_key: "how_to",
    access_level: "public",
    published_at: day(2),
    status: "online",
    body: {
      markdown: `这段演示视频展示了内容生产的四个关键节点。视频文件为公开示例素材（CC0），仅用于演示播放器。

## 四个节点

- 线索收录：保存来源链接与摘要
- 选题立项：写清核心观点
- AI 草案：作为提案，等待人工采纳
- 人工审核：通过后才可发布`,
      media: [
        {
          kind: "video",
          url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          caption: "示例视频（CC0 公共素材，仅演示播放器）",
        },
      ],
      source_refs: [],
    },
  }),
  entry({
    id: "e-cost-ledger",
    slug: "ai-cost-ledger-template",
    title: "给 AI 任务记一本成本账：字段设计与复盘方法",
    summary: "注册读者专享：一套可直接套用的 AI 任务成本账字段，以及每周复盘时该看的三个指标。",
    category_id: "cat-enterprise",
    format: "tutorial",
    column_key: "case",
    access_level: "registered",
    published_at: day(3),
    status: "online",
    body: {
      markdown: `## 成本账字段

- 任务 ID、任务类型
- 模型与 Prompt 版本
- 输入 / 输出 Token
- 实际费用与重试次数
- 人工审核结论

## 每周复盘看什么

1. 单位产出成本是否下降
2. 重试率是否异常
3. 被退回的原因分布

> 本文为注册读者内容的演示快照。`,
      media: [],
      source_refs: [],
    },
  }),
  entry({
    id: "e-story-lighthouse",
    slug: "the-lighthouse-keeper-and-the-model",
    title: "守灯人与模型：一个关于“人类门禁”的小故事",
    summary: "灯塔可以自动亮起，但决定船只能否靠岸的，仍然是守灯人。一个讲给非技术同事听的故事。",
    category_id: "cat-story",
    format: "article",
    column_key: null,
    access_level: "public",
    published_at: day(4),
    status: "online",
    body: {
      markdown: `老周在灯塔上守了二十年。今年，塔里装上了会自己判断天气的系统。

系统很准，几乎每一次都对。可老周还是每晚都上楼看一眼。

“你不信它？”新来的年轻人问。

“我信它，”老周说，“所以我才知道哪一次它可能不对。”

---

*这是一个演示故事，用来说明：自动化负责“做”，人负责“批准”。*`,
      media: [],
      source_refs: [],
    },
  }),
  entry({
    id: "e-prompt-checklist",
    slug: "prompt-review-checklist",
    title: "提示词上线前的十项检查清单",
    summary: "注册读者专享：从指令数据分离到输出格式校验，十项可以逐条打勾的检查。",
    category_id: "cat-workflow",
    format: "tutorial",
    column_key: "how_to",
    access_level: "registered",
    published_at: day(5),
    status: "online",
    body: {
      markdown: `## 检查清单

1. 外部资料是否包在不可信数据区
2. 是否声明了输出格式
3. 是否有拒答条件
4. 是否限制了长度
5. 是否记录了 Prompt 版本
6. 是否有评估样例
7. 是否覆盖了边界输入
8. 是否避免泄露内部字段
9. 失败时是否有可读提示
10. 是否需要人工复核`,
      media: [],
      source_refs: [],
    },
  }),
  entry({
    id: "e-agent-vocabulary",
    slug: "agent-vocabulary-for-managers",
    title: "给管理者的 Agent 词汇表：12 个词就够了",
    summary: "Context、Tool、Proposal、Mandate……用一句话解释一个词，帮助团队在同一套语言里讨论 AI 项目。",
    category_id: "cat-basics",
    format: "article",
    column_key: "news",
    access_level: "public",
    published_at: day(6),
    status: "online",
    body: {
      markdown: `## 词汇表

- **Context（上下文）**：模型这一次能看到的全部信息
- **Tool（工具）**：模型可以调用的外部能力
- **Proposal（提案）**：Agent 的产出，需要人批准
- **Mandate（授权）**：哪些动作必须由人签字`,
      media: [],
      source_refs: [],
    },
  }),
  // Offline entry: present in the demo store to prove it never reaches readers.
  entry({
    id: "e-offline",
    slug: "withdrawn-entry",
    title: "已下线的示例内容",
    summary: "此条目已下线，不应出现在任何列表中。",
    category_id: "cat-basics",
    format: "article",
    column_key: null,
    access_level: "public",
    published_at: day(7),
    status: "offline",
    body: { markdown: "下线内容正文（不可见）", media: [], source_refs: [] },
  }),
]

export const demoTopics: (Omit<SiteTopic, "entry_count"> & { entryIds: string[] })[] = [
  {
    id: "t-agent-path",
    slug: "enterprise-agent-path",
    title: "企业 Agent 入门路径",
    description: "从概念、边界到成本账，按顺序读完即可开始第一个真实试点。",
    cover_url: "",
    cover_alt: "",
    sort_order: 10,
    entryIds: ["e-agent-vocabulary", "e-agent-failures", "e-cost-ledger", "e-offline"],
  },
  {
    id: "t-workflow",
    slug: "content-workflow",
    title: "AI 内容工作流",
    description: "从线索到发布，一条可追溯、有人类门禁的内容流水线。",
    cover_url: "",
    cover_alt: "",
    sort_order: 20,
    entryIds: ["e-workflow-video", "e-prompt-checklist", "e-story-lighthouse"],
  },
]

export const demoResources: SiteResource[] = [
  {
    id: "r-checklist",
    entry_id: "e-prompt-checklist",
    title: "提示词上线检查清单（可打印）",
    description: "与《提示词上线前的十项检查清单》配套的打印版。",
    file_name: "prompt-checklist-demo.txt",
    mime_type: "text/plain",
    size_bytes: 2048,
    access_level: "registered",
  },
  {
    id: "r-glossary",
    entry_id: null,
    title: "Agent 词汇表速查卡",
    description: "12 个关键词的一页速查。",
    file_name: "agent-glossary-demo.txt",
    mime_type: "text/plain",
    size_bytes: 1024,
    access_level: "public",
  },
]
