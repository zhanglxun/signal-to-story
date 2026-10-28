import {
  DEFAULT_SITE_ID,
  type Category,
  type ContentColumn,
  type ContentForm,
  type EntryCard,
  type ResourceCard,
  type SourceRef,
} from "@/contracts/site"

/**
 * Layout fixtures for the P1 shell.
 * Registered markdown is a generic placeholder, not a protected article.
 * Real registered snapshots must stay behind RLS and must not be added here.
 */

type EntryDraft = {
  id: string
  slug: string
  title: string
  summary: string
  categorySlug: string
  form: ContentForm
  column: ContentColumn
  accessLevel: EntryCard["accessLevel"]
  publishedAt: string
  updatedAt: string
  featured?: boolean
  sources?: SourceRef[]
}

const categoriesBySlug: Record<string, string> = {
  enterprise: "企业 AI 实战",
  "ai-literacy": "AI 知识科普",
  tools: "工具与工作流",
  stories: "故事与创意",
}

const drafts: EntryDraft[] = [
  {
    id: "entry-013",
    slug: "approve-before-publish",
    title: "批准之后，站点才看得到",
    summary: "后台审核通过、发到外部平台，都不等于这篇已经上了读者站。",
    categorySlug: "enterprise",
    form: "article",
    column: "news",
    accessLevel: "public",
    publishedAt: "2026-10-20T08:00:00.000+08:00",
    updatedAt: "2026-10-21T09:30:00.000+08:00",
    featured: true,
    sources: [
      {
        title: "站点发布边界",
        url: "https://example.com/site-release-boundary",
      },
    ],
  },
  {
    id: "entry-012",
    slug: "workflow-checklist",
    title: "把一次工作流写成可复用清单",
    summary: "步骤、输入和人工确认点分开写，下次才复用得起来。",
    categorySlug: "tools",
    form: "tutorial",
    column: "how_to",
    accessLevel: "public",
    publishedAt: "2026-10-18T08:00:00.000+08:00",
    updatedAt: "2026-10-18T08:00:00.000+08:00",
    featured: true,
  },
  {
    id: "entry-011",
    slug: "model-limits",
    title: "模型边界需要写进人能看懂的话",
    summary: "模型会犯错。读者需要先看到边界，再决定要不要继续。",
    categorySlug: "ai-literacy",
    form: "article",
    column: "analysis",
    accessLevel: "registered",
    publishedAt: "2026-10-16T08:00:00.000+08:00",
    updatedAt: "2026-10-17T11:00:00.000+08:00",
    featured: true,
  },
  {
    id: "entry-010",
    slug: "story-seed",
    title: "一条线索怎样长成故事",
    summary: "先保住事实和出处，再决定叙事顺序。",
    categorySlug: "stories",
    form: "article",
    column: "case",
    accessLevel: "public",
    publishedAt: "2026-10-14T08:00:00.000+08:00",
    updatedAt: "2026-10-14T08:00:00.000+08:00",
  },
  {
    id: "entry-009",
    slug: "review-notes",
    title: "审核意见不该出现在读者摘要里",
    summary: "审稿备注留在后台。读者只看到批准后的摘要和正文。",
    categorySlug: "enterprise",
    form: "article",
    column: "analysis",
    accessLevel: "public",
    publishedAt: "2026-10-12T08:00:00.000+08:00",
    updatedAt: "2026-10-12T08:00:00.000+08:00",
  },
  {
    id: "entry-008",
    slug: "prompt-to-steps",
    title: "从提示词到步骤",
    summary: "把一次有效的提示拆成输入、约束和检查，而不是再贴一整段咒语。",
    categorySlug: "tools",
    form: "tutorial",
    column: "how_to",
    accessLevel: "public",
    publishedAt: "2026-10-10T08:00:00.000+08:00",
    updatedAt: "2026-10-10T08:00:00.000+08:00",
  },
  {
    id: "entry-007",
    slug: "source-quotes",
    title: "引用要能点回原处",
    summary: "读者看得到的出处只保留公开链接，不带内部素材地址。",
    categorySlug: "ai-literacy",
    form: "article",
    column: "news",
    accessLevel: "registered",
    publishedAt: "2026-10-08T08:00:00.000+08:00",
    updatedAt: "2026-10-08T08:00:00.000+08:00",
  },
  {
    id: "entry-006",
    slug: "desk-tools",
    title: "桌上的三个工具",
    summary: "工具页只介绍已经能交给读者的东西，不摆空的视频入口。",
    categorySlug: "tools",
    form: "tutorial",
    column: "how_to",
    accessLevel: "public",
    publishedAt: "2026-10-06T08:00:00.000+08:00",
    updatedAt: "2026-10-06T08:00:00.000+08:00",
  },
  {
    id: "entry-005",
    slug: "case-handoff",
    title: "一个交接案例",
    summary: "交接时留下版本、负责人和还没做的决定。",
    categorySlug: "enterprise",
    form: "article",
    column: "case",
    accessLevel: "public",
    publishedAt: "2026-10-04T08:00:00.000+08:00",
    updatedAt: "2026-10-05T08:00:00.000+08:00",
  },
  {
    id: "entry-004",
    slug: "quiet-draft",
    title: "草稿不是发布",
    summary: "草稿、待审和退回都不会出现在这个站点上。",
    categorySlug: "stories",
    form: "article",
    column: "news",
    accessLevel: "public",
    publishedAt: "2026-10-02T08:00:00.000+08:00",
    updatedAt: "2026-10-02T08:00:00.000+08:00",
  },
  {
    id: "entry-003",
    slug: "glossary",
    title: "给同事的词汇表",
    summary: "同一件事只用一个词。这份词汇表注册后可以继续读。",
    categorySlug: "ai-literacy",
    form: "tutorial",
    column: "how_to",
    accessLevel: "registered",
    publishedAt: "2026-09-28T08:00:00.000+08:00",
    updatedAt: "2026-09-28T08:00:00.000+08:00",
  },
  {
    id: "entry-002",
    slug: "weekly-signal",
    title: "一周信号怎么收",
    summary: "每周只留下还能回溯到来源的信号，不堆阅读量。",
    categorySlug: "enterprise",
    form: "article",
    column: "news",
    accessLevel: "public",
    publishedAt: "2026-09-20T08:00:00.000+08:00",
    updatedAt: "2026-09-20T08:00:00.000+08:00",
  },
  {
    id: "entry-001",
    slug: "scene-sketch",
    title: "场景速写",
    summary: "场景先写能看见的东西，不提前写结论。",
    categorySlug: "stories",
    form: "article",
    column: "case",
    accessLevel: "public",
    publishedAt: "2026-09-12T08:00:00.000+08:00",
    updatedAt: "2026-09-12T08:00:00.000+08:00",
  },
]

function publicBody(title: string) {
  return [
    `## 这篇文章在说什么`,
    "",
    `${title}是开发占位稿，用来核对阅读页的标题、目录和宽度。`,
    "",
    "## 可以核对的部分",
    "",
    "- 发布时间和更新时间",
    "- 分类、形式和栏目",
    "- 来源链接只保留 http 与 https",
    "",
    "### 版式",
    "",
    "窄栏阅读，手机和桌面都从同一套主题 token 取色。",
  ].join("\n")
}

function registeredBody() {
  return [
    "## 注册后的正文位置",
    "",
    "这里是注册可读正文的版式占位。正式快照只从数据接口按登录身份返回，不把真实受限正文写进静态包。",
    "",
    "### 预览会话",
    "",
    "当前登录如果只是本地预览，刷新后收藏还在，但不会变成后台权限。",
  ].join("\n")
}

export const fixtureEntries: EntryCard[] = drafts.map((draft) => ({
  id: draft.id,
  siteId: DEFAULT_SITE_ID,
  slug: draft.slug,
  title: draft.title,
  summary: draft.summary,
  categorySlug: draft.categorySlug,
  categoryName: categoriesBySlug[draft.categorySlug] ?? draft.categorySlug,
  form: draft.form,
  column: draft.column,
  accessLevel: draft.accessLevel,
  publishedAt: draft.publishedAt,
  updatedAt: draft.updatedAt,
  featured: draft.featured ?? false,
}))

export const fixtureBodies = new Map<string, { markdown: string; sources: SourceRef[] }>(
  drafts.map((draft) => [
    draft.slug,
    {
      markdown: draft.accessLevel === "registered" ? registeredBody() : publicBody(draft.title),
      sources: draft.sources ?? [],
    },
  ])
)

export const fixtureCategories: Category[] = [
  {
    slug: "enterprise",
    name: "企业 AI 实战",
    description: "把模型放进真实流程之前要先看清的部分。",
    sort: 10,
    enabled: true,
  },
  {
    slug: "ai-literacy",
    name: "AI 知识科普",
    description: "用可以核对的话说清能力边界。",
    sort: 20,
    enabled: true,
  },
  {
    slug: "tools",
    name: "工具与工作流",
    description: "把重复步骤收成清单。",
    sort: 30,
    enabled: true,
  },
  {
    slug: "stories",
    name: "故事与创意",
    description: "线索、场景和叙事草稿。",
    sort: 40,
    enabled: true,
  },
  {
    slug: "lab",
    name: "实验笔记",
    description: "还没有已发布内容，不占首页推荐位。",
    sort: 50,
    enabled: true,
  },
  {
    slug: "hidden",
    name: "内部草稿分类",
    description: "未启用，读者站不展示。",
    sort: 90,
    enabled: false,
  },
]

export const fixtureTopics: { slug: string; title: string; description: string; itemSlugs: string[] }[] = [
  {
    slug: "before-shipping",
    title: "上线之前",
    description: "从批准、摘要到交接，按这个顺序看一遍。",
    itemSlugs: ["approve-before-publish", "review-notes", "case-handoff", "quiet-draft"],
  },
  {
    slug: "practice",
    title: "动手练习",
    description: "三篇都是可以把步骤照着走一遍的教程。",
    itemSlugs: ["workflow-checklist", "prompt-to-steps", "desk-tools"],
  },
]

export const fixtureResources: ResourceCard[] = [
  {
    id: "res-checklist",
    title: "工作流核对表",
    description: "跟教程配套的公开核对表。下载地址要等对象存储接入后签发。",
    accessLevel: "public",
    entrySlug: "workflow-checklist",
    status: "available",
  },
  {
    id: "res-glossary",
    title: "词汇表底稿",
    description: "注册读者可以申请下载。当前不会签发文件地址。",
    accessLevel: "registered",
    entrySlug: "glossary",
    status: "available",
  },
  {
    id: "res-old",
    title: "已撤回的素材包",
    description: "下线后不再提供下载。",
    accessLevel: "public",
    entrySlug: null,
    status: "revoked",
  },
]

export const CATALOG_ERROR_SLUG = "status-error"
