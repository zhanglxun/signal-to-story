import {
  newCaptureIdempotencyKey,
  parseCaptureInput,
} from "@/contracts/quick-capture"
import { enqueueContentDraftJob } from "@/services/agent-job-service"
import { listDocuments } from "@/services/content-service"
import { submitQuickCapture } from "@/services/quick-capture-service"
import { enqueueStoryboardJob } from "@/services/video-studio-service"
import { listWorkItems, listWorkItemDocuments } from "@/services/work-item-service"
import type {
  ContextRefOption,
  SlashCardItem,
  SlashCommandMeta,
  SlashCommandName,
} from "@/modules/chat/types"

export const SLASH_COMMANDS: readonly SlashCommandMeta[] = [
  {
    name: "capture",
    command: "/capture",
    label: "极简速记收录",
    description: "将链接或灵感直接写入收件箱，不经过模型（零 token）",
    needsArg: true,
    placeholder: "/capture https://... 一句话备注",
  },
  {
    name: "draft",
    command: "/draft",
    label: "派发 AI 出稿",
    description: "为当前绑定事项入队后台 content_draft 任务",
    needsArg: false,
    placeholder: "/draft 补充写作要求（可选）",
  },
  {
    name: "storyboard",
    command: "/storyboard",
    label: "生成视频分镜",
    description: "为当前绑定事项入队后台 video_storyboard 任务",
    needsArg: false,
    placeholder: "/storyboard 大纲补充说明（可选）",
  },
  {
    name: "work",
    command: "/work",
    label: "绑定 / 切换事项",
    description: "关联或切换当前会话绑定的 work_item_id",
    needsArg: false,
    placeholder: "/work",
  },
  {
    name: "clear",
    command: "/clear",
    label: "新建空白上下文",
    description: "新建会话并继承当前事项与模型配置，旧会话保留在侧栏",
    needsArg: false,
    placeholder: "/clear",
  },
]

const COMMAND_NAMES = new Set<SlashCommandName>([
  "capture",
  "draft",
  "storyboard",
  "work",
  "clear",
])

export function parseSlashCommand(
  raw: string
): { command: SlashCommandName; args: string } | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("/")) return null
  const match = trimmed.match(/^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  const name = match[1].toLowerCase() as SlashCommandName
  if (!COMMAND_NAMES.has(name)) return null
  return { command: name, args: (match[2] ?? "").trim() }
}

const MOCK_REFERENCE_OPTIONS: readonly ContextRefOption[] = [
  {
    kind: "work_item",
    id: "mock-wi-1",
    label: "为什么个人内容创作者需要 Agent Harness",
    subtitle: "事项 · article · doing",
  },
  {
    kind: "work_item",
    id: "mock-wi-2",
    label: "2026 多模态分镜流水线实测笔记",
    subtitle: "事项 · video · todo",
  },
  {
    kind: "document",
    id: "mock-doc-1",
    label: "公众号：指令数据分离实战指南",
    subtitle: "稿件 · wechat_official · v2",
  },
  {
    kind: "document",
    id: "mock-doc-2",
    label: "X 长推文：内容工厂为什么需要 Mandate 门禁",
    subtitle: "稿件 · x · v1",
  },
]

export async function listReferenceOptions(
  organizationId: string | null,
  mockMode: boolean
): Promise<ContextRefOption[]> {
  if (mockMode || !organizationId) {
    return [...MOCK_REFERENCE_OPTIONS]
  }
  const [items, docs] = await Promise.all([
    listWorkItems(organizationId),
    listDocuments(organizationId),
  ])
  return [
    ...items.slice(0, 40).map((item) => ({
      kind: "work_item" as const,
      id: item.id,
      label: item.title,
      subtitle: `事项 · ${item.kind} · ${item.status}`,
    })),
    ...docs.slice(0, 40).map((doc) => ({
      kind: "document" as const,
      id: doc.id,
      label: doc.title || `${doc.platform} 稿件`,
      subtitle: `稿件 · ${doc.platform} · v${doc.revision}`,
    })),
  ]
}

export async function runCaptureSlashCommand(options: {
  rawInput: string
  organizationId: string | null
  mockMode: boolean
}): Promise<SlashCardItem> {
  const parsed = parseCaptureInput(options.rawInput)
  if (parsed.kind === "empty") {
    return {
      id: `slash-${Date.now()}`,
      command: "capture",
      title: "速记内容为空",
      summary: "请在 `/capture` 后粘贴链接或输入至少一句话灵感。",
      status: "failed",
      createdAt: new Date().toISOString(),
    }
  }

  if (options.mockMode || !options.organizationId) {
    return {
      id: `slash-${Date.now()}`,
      command: "capture",
      title: "已收录到收件箱（Mock）",
      summary: parsed.url
        ? `已提取链接 ${parsed.url}${parsed.note ? ` · 备注：${parsed.note}` : ""}`
        : `已保存速记：${parsed.note ?? options.rawInput}`,
      status: "succeeded",
      linkTo: "/intake",
      linkLabel: "前往收件箱 →",
      createdAt: new Date().toISOString(),
    }
  }

  const res = await submitQuickCapture({
    organizationId: options.organizationId,
    url: parsed.url,
    note: parsed.note,
    intent: "capture_only",
    platforms: [],
    idempotencyKey: newCaptureIdempotencyKey(),
  })
  return {
    id: `slash-${Date.now()}`,
    command: "capture",
    title: res.duplicate ? "已命中幂等收录" : "已收录到收件箱",
    summary: `事件 ID: ${res.eventId}`,
    status: "succeeded",
    linkTo: res.inboxPath || "/intake",
    linkLabel: "查看收件箱 →",
    createdAt: new Date().toISOString(),
  }
}

export async function runDraftSlashCommand(options: {
  instruction: string
  workItemId: string | null
  documentId?: string | null
  mockMode: boolean
}): Promise<SlashCardItem> {
  const targetId = options.documentId ?? null
  if (!options.workItemId && !targetId) {
    return {
      id: `slash-${Date.now()}`,
      command: "draft",
      title: "需要先绑定事项或引用稿件",
      summary: "请先用 `/work` 绑定事项，或用 `@` 选择一张稿件后再执行 `/draft`。",
      status: "failed",
      createdAt: new Date().toISOString(),
    }
  }

  if (options.mockMode) {
    return {
      id: `slash-${Date.now()}`,
      command: "draft",
      title: "已入队后台出稿任务（Mock）",
      summary: `目标：${targetId ? `稿件 ${targetId}` : `事项 ${options.workItemId}`}${options.instruction ? ` · 要求：${options.instruction}` : ""}`,
      status: "succeeded",
      linkTo: options.workItemId ? `/work-items/${options.workItemId}` : "/tasks",
      linkLabel: "查看任务与事项 →",
      createdAt: new Date().toISOString(),
    }
  }

  let docId = targetId
  if (!docId && options.workItemId) {
    const docs = await listWorkItemDocuments(options.workItemId)
    const masterOrFirst = docs.find((d) => d.platform === "master") ?? docs[0]
    docId = masterOrFirst?.id ?? null
  }
  if (!docId) {
    return {
      id: `slash-${Date.now()}`,
      command: "draft",
      title: "当前事项尚未创建稿件",
      summary: "请先在事项详情创建母稿或平台稿件，再派发出稿任务。",
      status: "failed",
      linkTo: options.workItemId ? `/work-items/${options.workItemId}` : undefined,
      linkLabel: "打开事项页 →",
      createdAt: new Date().toISOString(),
    }
  }

  const res = await enqueueContentDraftJob({
    documentId: docId,
    instruction: options.instruction || "基于关联事项 Brief 与信源撰写完整结构化初稿。",
  })
  return {
    id: `slash-${Date.now()}`,
    command: "draft",
    title: res.duplicate ? "出稿任务已在队列中" : "已入队 content_draft 任务",
    summary: `任务 ${res.jobId} · 状态 ${res.status}`,
    status: "succeeded",
    linkTo: `/tasks/${res.jobId}`,
    linkLabel: "查看任务详情 →",
    createdAt: new Date().toISOString(),
  }
}

export async function runStoryboardSlashCommand(options: {
  outline: string
  organizationId: string | null
  workItemId: string | null
  mockMode: boolean
}): Promise<SlashCardItem> {
  if (!options.workItemId) {
    return {
      id: `slash-${Date.now()}`,
      command: "storyboard",
      title: "请先绑定事项",
      summary: "请先使用 `/work` 选择一个视频或图文事项，再派发 `/storyboard`。",
      status: "failed",
      createdAt: new Date().toISOString(),
    }
  }

  if (options.mockMode || !options.organizationId) {
    return {
      id: `slash-${Date.now()}`,
      command: "storyboard",
      title: "已派发视频分镜任务（Mock）",
      summary: `事项 ${options.workItemId}${options.outline ? ` · 大纲：${options.outline}` : ""}`,
      status: "succeeded",
      linkTo: `/work-items/${options.workItemId}`,
      linkLabel: "前往事项视频区 →",
      createdAt: new Date().toISOString(),
    }
  }

  const job = await enqueueStoryboardJob({
    organizationId: options.organizationId,
    workItemId: options.workItemId,
    outline: options.outline || "请依据事项 Brief 规划首版短视频分镜草稿。",
  })
  return {
    id: `slash-${Date.now()}`,
    command: "storyboard",
    title: "已入队 video_storyboard 任务",
    summary: `任务 ${job.id} · 状态 ${job.status}`,
    status: "succeeded",
    linkTo: `/tasks/${job.id}`,
    linkLabel: "查看分镜任务 →",
    createdAt: new Date().toISOString(),
  }
}
