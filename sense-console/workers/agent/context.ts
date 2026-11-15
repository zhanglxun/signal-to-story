import type { DecisionMemoryItem, KnowledgeTrustLevel } from "../../src/contracts/agent-harness"
import { buildSafeContextPack } from "../../src/harness/context-pack"
import type { HarnessJob } from "../../src/harness/job-store"
import type { HarnessDraftContext } from "../../src/harness/loop-controller"
import type { DraftContextRows } from "./backend"

const PLATFORM_SOP: Record<string, string> = {
  master: "母稿：完整保留论点、证据链与引用，结构化小标题。",
  x: "X：开门见山给出核心洞察，精炼短文或清晰 Thread，控制在 2000 字符以内。",
  wechat_official: "公众号：叙事节奏、小标题、金句总结，适配手机阅读。",
  xiaohongshu: "小红书：口语化、分点、真实体验感，避免夸张营销。",
}

export const MAX_TRUSTED_KNOWLEDGE = 8
export const MAX_REFERENCE_KNOWLEDGE = 3

/** Turn DB rows into the loop controller's input. Pure; tested through the PGlite e2e test. */
export function assembleDraftContext(job: HarnessJob, rows: DraftContextRows): HarnessDraftContext {
  const instruction = String(job.payload.instruction ?? "").trim()
  if (!instruction) throw new Error("任务缺少创作要求 (payload.instruction)")
  if (job.targetRevision != null && rows.document.revision !== job.targetRevision) {
    // The human edited the document after queueing; drafting against stale text is pointless.
    throw new StaleTargetError(`稿件已从 v${job.targetRevision} 变为 v${rows.document.revision}，请重新发起生成`)
  }
  const platform = rows.document.platform
  const contentKind = rows.project?.content_kind ?? null

  const memories: DecisionMemoryItem[] = rows.memories.map((m) => ({
    id: m.id,
    organizationId: job.organizationId,
    kind: m.kind as DecisionMemoryItem["kind"],
    summary: m.summary,
    humanQuote: m.human_quote,
    recordedAt: new Date(m.created_at).toISOString(),
    active: m.active,
    platform: m.platform,
    contentKind: m.content_kind,
    expiresAt: m.expires_at ? new Date(m.expires_at).toISOString() : null,
  }))

  const trusted = rows.knowledge.filter((k) => k.trust_level === "trusted").slice(0, MAX_TRUSTED_KNOWLEDGE)
  const reference = rows.knowledge
    .filter((k) => k.trust_level === "unreviewed" && (k.tags ?? []).some((t) => t === platform || t === contentKind))
    .slice(0, MAX_REFERENCE_KNOWLEDGE)

  const sources: HarnessDraftContext["sources"] = []
  if (rows.signal) {
    sources.push({
      sourceId: `signal:${rows.signal.id}`,
      content: [rows.signal.name, rows.signal.site_url, rows.signal.summary, rows.signal.description].filter(Boolean).join("\n"),
    })
  }

  const forbiddenPhrases = [
    ...(Array.isArray(job.payload.forbidden_phrases) ? (job.payload.forbidden_phrases as unknown[]).map(String) : []),
    // Short taboo memories are treated as literal phrases for the deterministic precheck.
    ...memories.filter((m) => m.kind === "taboo_topic" && m.summary.length <= 30).map((m) => m.summary),
  ]

  const brief = JSON.stringify(
    rows.project
      ? { title: rows.project.title, brief: rows.project.brief, content_kind: rows.project.content_kind, target_seconds: rows.project.target_seconds, aspect_ratio: rows.project.aspect_ratio, thesis: rows.selection?.core_thesis ?? null }
      : {}
  )

  const contextPack = buildSafeContextPack({
    organizationId: job.organizationId,
    taskGoal: `为平台 ${platform} 改写/撰写稿件《${rows.document.title}》。人工创作要求：${instruction}`,
    platform,
    contentKind,
    systemSop: PLATFORM_SOP[platform] ?? "遵循目标平台的篇幅与语气规范。",
    decisionMemories: memories,
    knowledgeSnippets: [
      ...trusted.map((k) => ({ slug: k.slug, title: k.title, content: k.content, trustLevel: "trusted" as KnowledgeTrustLevel })),
      ...reference.map((k) => ({ slug: k.slug, title: k.title, content: k.content, trustLevel: "unreviewed" as KnowledgeTrustLevel })),
    ],
    untrustedSources: sources.map((s) => ({ sourceId: s.sourceId, channel: "signal", url: rows.signal?.site_url ?? null, rawText: s.content, capturedAt: rows.signal ? new Date(rows.signal.created_at).toISOString() : new Date().toISOString() })),
  })

  return {
    documentId: rows.document.id,
    documentRevision: rows.document.revision,
    platform,
    title: rows.document.title,
    body: rows.document.body,
    instruction,
    brief,
    contextPack,
    sources,
    forbiddenPhrases,
    evaluatorRules: memories.slice(0, 20).map((m) => `[${m.kind}] ${m.summary}`),
  }
}

export class StaleTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StaleTargetError"
  }
}
