import type { DecisionMemoryItem, DecisionMemoryKind } from "./agent-harness"

export type DecisionMemorySource = "review_event" | "retrospective" | "manual"

/** Row of public.decision_memories mapped to camelCase. */
export interface DecisionMemoryRecord extends DecisionMemoryItem {
  source: DecisionMemorySource
  sourceRef: string | null
  createdBy: string
  updatedAt: string
}

export const decisionMemoryKindLabels: Record<DecisionMemoryKind, string> = {
  approved_preference: "认可的做法",
  rejected_pattern: "要避免的做法",
  style_rule: "风格规则",
  taboo_topic: "禁忌话题",
}
export const decisionMemoryKinds = Object.keys(decisionMemoryKindLabels) as DecisionMemoryKind[]

export const decisionMemorySourceLabels: Record<DecisionMemorySource, string> = {
  review_event: "审核",
  retrospective: "复盘",
  manual: "手动",
}

/** Platforms a memory can be scoped to (matches the decision_memories.platform check). */
export const memoryPlatformLabels: Record<string, string> = {
  master: "母稿",
  wechat_channels: "视频号",
  wechat_official: "公众号",
  xiaohongshu: "小红书",
  douyin: "抖音",
  x: "X",
  youtube: "YouTube",
  reddit: "Reddit",
  site: "读者站",
}
export const memoryPlatformKeys = Object.keys(memoryPlatformLabels)

export const MEMORY_SUMMARY_MAX = 500
export const MEMORY_QUOTE_MAX = 2000

export interface DecisionMemoryInput {
  organizationId: string
  kind: DecisionMemoryKind
  summary: string
  humanQuote?: string
  /** null/undefined = global. */
  platform?: string | null
  contentKind?: string | null
  expiresAt?: string | null
  source?: DecisionMemorySource
  sourceRef?: string | null
}
