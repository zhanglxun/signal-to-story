/**
 * The MVP chat tools (docs/modules/chat.md 2.5 / 4.2): fixed functions, each calling exactly one RPC
 * (or one RLS read) with the USER's identity. The model only sees the tool specs and results, never
 * the JWT; there is no generic RPC / SQL / HTTP tool, and nothing that approves, publishes or deletes.
 */
import type { ChatToolResult, ChatToolSpec } from "../loop/chat/driver"
import { CHAT_TOOL_ALLOWLIST, type ChatToolName } from "../loop/chat/tools"
import type { UserDataApi } from "../backends/chat-db"

/** The one RPC (or RLS table read) behind each tool; enumerated by a unit test. */
export const CHAT_TOOL_BACKING: Record<ChatToolName, string> = {
  capture_intake: "rpc:record_intake_event",
  read_work_item: "select:work_items+content_documents",
  enqueue_content_draft: "rpc:enqueue_agent_job",
}

export const CHAT_TOOL_SPECS: Record<ChatToolName, ChatToolSpec> = {
  capture_intake: {
    name: "capture_intake",
    description: "把一条灵感、链接或资料记到收件箱（速记），之后由人整理成事项。只在用户明确要求「记下来 / 收录」时使用。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "要记下的内容（1–4000 字）" },
        url: { type: "string", description: "相关链接（可选，http/https）" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  read_work_item: {
    name: "read_work_item",
    description: "读取一个事项（选题卡）的标题、状态、简介，以及它下面各稿件的标题与状态（不含正文）。",
    inputSchema: {
      type: "object",
      properties: { work_item_id: { type: "string", description: "事项 id（uuid）" } },
      required: ["work_item_id"],
      additionalProperties: false,
    },
  },
  enqueue_content_draft: {
    name: "enqueue_content_draft",
    description: "为一篇稿件排队一次 AI 出稿（后台任务，会产生模型费用，需要用户确认）。产出是草稿，仍需人工审核。",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "稿件 id（uuid）" },
        instruction: { type: "string", description: "创作要求（1–4000 字）" },
      },
      required: ["document_id", "instruction"],
      additionalProperties: false,
    },
  },
}

/** All allowlisted tools, in allowlist order. */
export function chatToolSpecs(): ChatToolSpec[] {
  return CHAT_TOOL_ALLOWLIST.map((name) => CHAT_TOOL_SPECS[name])
}

export interface ChatToolContext {
  user: UserDataApi
  organizationId: string
  jobId: string
  sessionId: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

const invalid = (message: string): ChatToolResult => ({ ok: false, outputSummary: message, output: null, error: message })
const dbFailed = (what: string, message: string): ChatToolResult => ({ ok: false, outputSummary: `${what}失败`, output: null, error: message.slice(0, 500) })

/** Runs one allowlisted tool as the user. Unknown names never reach here (runChatTurn checks the allowlist). */
export function createChatToolExecutor(ctx: ChatToolContext) {
  let captures = 0
  let drafts = 0
  return async function executeTool(name: string, input: unknown): Promise<ChatToolResult> {
    const args = obj(input)
    switch (name as ChatToolName) {
      case "capture_intake": {
        const text = str(args.text)
        const url = str(args.url)
        if (!text || text.length > 4000) return invalid("text 需为 1–4000 字")
        if (url && !/^https?:\/\/\S+$/i.test(url)) return invalid("url 只支持 http/https 链接")
        captures += 1
        const { data, error } = await ctx.user.rpc<{ id: string }>("record_intake_event", {
          p_organization_id: ctx.organizationId,
          p_source: "chat",
          p_external_id: `chat:${ctx.jobId}:${captures}`,
          p_text: text,
          p_url: url || null,
          p_payload: { chat_session_id: ctx.sessionId, agent_job_id: ctx.jobId },
          p_connection_id: null,
        })
        if (error || !data) return dbFailed("收录", error?.message ?? "无返回")
        return { ok: true, outputSummary: "已记到收件箱", output: { intake_event_id: data.id } }
      }
      case "read_work_item": {
        const id = str(args.work_item_id)
        if (!UUID.test(id)) return invalid("work_item_id 应为 uuid")
        const item = await ctx.user.getWorkItem(id)
        if (!item) return { ok: false, outputSummary: "事项不存在或无权访问", output: null, error: "not_found" }
        const documents = await ctx.user.listWorkItemDocuments(id)
        return {
          ok: true,
          outputSummary: `事项「${item.title}」，${documents.length} 篇稿件`,
          output: {
            id: item.id,
            kind: item.kind,
            title: item.title,
            status: item.status,
            brief: item.brief,
            documents: documents.map((d) => ({ id: d.id, platform: d.platform, title: d.title, status: d.status, revision: d.revision })),
          },
        }
      }
      case "enqueue_content_draft": {
        const documentId = str(args.document_id)
        const instruction = str(args.instruction)
        if (!UUID.test(documentId)) return invalid("document_id 应为 uuid")
        if (!instruction || instruction.length > 4000) return invalid("instruction 需为 1–4000 字")
        const doc = await ctx.user.getDocument(documentId)
        if (!doc) return { ok: false, outputSummary: "稿件不存在或无权访问", output: null, error: "not_found" }
        drafts += 1
        // Same RPC and arguments as the console (sense-console agent-job-service enqueueContentDraftJob).
        const { data, error } = await ctx.user.rpc<{ id: string; status: string }>("enqueue_agent_job", {
          p_organization_id: doc.organization_id,
          p_job_type: "content_draft",
          p_idempotency_key: `content_draft:${doc.id}:r${doc.revision}:chat:${ctx.jobId}:${drafts}`,
          p_payload: { document_id: doc.id, instruction, platform: doc.platform },
          p_target_type: "content_document",
          p_target_id: doc.id,
          p_target_revision: doc.revision,
          p_work_item_id: doc.work_item_id ?? null,
        })
        if (error || !data) return dbFailed("排队出稿", error?.message ?? "无返回")
        return { ok: true, outputSummary: `已为「${doc.title}」排队出稿`, output: { agent_job_id: data.id, status: data.status } }
      }
      default:
        return invalid(`工具 ${name} 不可用`)
    }
  }
}
