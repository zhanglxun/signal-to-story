import { cancelAgentJob } from "@/services/agent-job-service"
import { getSupabaseClient } from "@/lib/supabase"
import type {
  ChatMessage,
  ChatMessagePart,
  ChatMessageStatus,
  ChatRuntimeConfig,
  ChatSession,
} from "@/modules/chat/types"

export interface CreateChatSessionInput {
  organizationId: string
  ownerId: string
  title?: string
  workItemId?: string | null
  runtimeConfig?: ChatRuntimeConfig
}

export interface UpdateChatSessionPatch {
  title?: string
  workItemId?: string | null
  archivedAt?: string | null
  runtimeConfig?: ChatRuntimeConfig
}

export interface ActiveChatTurnJob {
  jobId: string
  status: "queued" | "running"
}

export interface ChatSessionRepository {
  listSessions(organizationId: string): Promise<ChatSession[]>
  createSession(input: CreateChatSessionInput): Promise<ChatSession>
  updateSession(sessionId: string, patch: UpdateChatSessionPatch): Promise<ChatSession>
  deleteSession(sessionId: string): Promise<void>
  listMessages(sessionId: string): Promise<ChatMessage[]>
  cancelJob(jobId: string): Promise<void>
  findActiveChatTurnJob?(sessionId: string): Promise<ActiveChatTurnJob | null>
  subscribeChatMessages?(sessionId: string, onInsert: () => void): () => void
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function mapChatSessionRow(row: Record<string, unknown>): ChatSession {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    ownerId: String(row.owner_id),
    workItemId: row.work_item_id == null ? null : String(row.work_item_id),
    title: String(row.title ?? ""),
    runtimeConfig: asObj(row.runtime_config) as ChatRuntimeConfig,
    lastSeq: Number(row.last_seq ?? 0),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapChatMessageRow(row: Record<string, unknown>): ChatMessage {
  const rawParts = Array.isArray(row.parts) ? (row.parts as ChatMessagePart[]) : []
  const rawStatus = row.status
  const status: ChatMessageStatus =
    rawStatus === "cancelled" || rawStatus === "error" ? rawStatus : "completed"

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    role: (row.role as ChatMessage["role"]) ?? "user",
    content: String(row.content ?? ""),
    parts: rawParts,
    status,
    agentJobId: row.agent_job_id == null ? null : String(row.agent_job_id),
    replyToMessageId:
      row.reply_to_message_id == null ? null : String(row.reply_to_message_id),
    createdAt: String(row.created_at),
  }
}

function requireDb() {
  const client = getSupabaseClient()
  if (!client) throw new Error("Supabase 尚未配置，无法读取云端会话。")
  return client
}

export function createSupabaseChatSessionRepository(): ChatSessionRepository {
  return {
    async listSessions(organizationId) {
      const { data, error } = await requireDb()
        .from("chat_sessions")
        .select("*")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(100)
      if (error) throw new Error(error.message || "读取会话列表失败")
      return (data ?? []).map((row) => mapChatSessionRow(row as Record<string, unknown>))
    },

    async createSession(input) {
      const { data, error } = await requireDb()
        .from("chat_sessions")
        .insert({
          organization_id: input.organizationId,
          work_item_id: input.workItemId ?? null,
          title: input.title ?? "",
          // DB3b grants insert (runtime_config): the session remembers node, runtime and effort.
          runtime_config: input.runtimeConfig ?? {},
        })
        .select("*")
        .single()
      if (error || !data) throw new Error(error?.message || "创建会话失败")
      return mapChatSessionRow(data as Record<string, unknown>)
    },

    async updateSession(sessionId, patch) {
      const updates: Record<string, unknown> = {}
      if (patch.title !== undefined) updates.title = patch.title
      if (patch.workItemId !== undefined) updates.work_item_id = patch.workItemId
      if (patch.archivedAt !== undefined) updates.archived_at = patch.archivedAt
      if (patch.runtimeConfig !== undefined) updates.runtime_config = patch.runtimeConfig

      const { data, error } = await requireDb()
        .from("chat_sessions")
        .update(updates)
        .eq("id", sessionId)
        .select("*")
        .single()
      if (error || !data) throw new Error(error?.message || "更新会话失败")
      return mapChatSessionRow(data as Record<string, unknown>)
    },

    async deleteSession(sessionId) {
      const { error } = await requireDb().from("chat_sessions").delete().eq("id", sessionId)
      if (error) throw new Error(error.message || "删除会话失败")
    },

    async listMessages(sessionId) {
      const { data, error } = await requireDb()
        .from("chat_messages")
        .select("*")
        .eq("session_id", sessionId)
        .order("seq", { ascending: true })
        .limit(200)
      if (error) throw new Error(error.message || "读取消息记录失败")
      return (data ?? []).map((row) => mapChatMessageRow(row as Record<string, unknown>))
    },

    async cancelJob(jobId) {
      await cancelAgentJob(jobId)
    },

    async findActiveChatTurnJob(sessionId) {
      const client = getSupabaseClient()
      if (!client) return null
      const { data, error } = await client
        .from("agent_jobs")
        .select("id,status")
        .eq("kind", "chat_turn")
        .eq("payload->target->>id", sessionId)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) return null
      const status = data.status === "queued" ? "queued" : "running"
      return { jobId: String(data.id), status }
    },

    subscribeChatMessages(sessionId, onInsert) {
      const client = getSupabaseClient()
      if (!client) return () => undefined
      const channel = client
        .channel(`chat-messages-${sessionId}-${Math.random().toString(36).slice(2, 8)}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `session_id=eq.${sessionId}`,
          },
          () => {
            onInsert()
          }
        )
        .subscribe()
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}

export interface MemoryChatStore extends ChatSessionRepository {
  insertUserMessage(input: {
    sessionId: string
    content: string
    parts?: ChatMessagePart[]
    agentJobId?: string | null
  }): ChatMessage
  appendAssistantMessage(input: {
    sessionId: string
    content: string
    parts: ChatMessagePart[]
    status: ChatMessageStatus
    agentJobId: string
    replyToMessageId: string
    usage?: ChatMessage["usage"]
    runtimeLabel?: string | null
  }): ChatMessage
  getMessageById(sessionId: string, messageId: string): ChatMessage | undefined
  setCancelHandler(fn: (jobId: string) => Promise<void>): void
  setActiveChatTurnJob(sessionId: string, job: ActiveChatTurnJob | null): void
}

function sortSessionsDesc(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export function createMemoryChatSessionRepository(options: { seed?: boolean } = {}): MemoryChatStore {
  const now = Date.now()
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString()

  let seqCounter = options.seed !== false ? 10 : 1
  const nextId = (prefix: string) => `${prefix}-${seqCounter++}`

  const sessions = new Map<string, ChatSession>()
  const messagesBySession = new Map<string, ChatMessage[]>()
  const activeJobsBySession = new Map<string, ActiveChatTurnJob>()
  let cancelHandler: (jobId: string) => Promise<void> = async () => undefined

  if (options.seed !== false) {
    const s1Id = "mock-session-1"
    const s2Id = "mock-session-2"

    sessions.set(s1Id, {
      id: s1Id,
      organizationId: "mock-org-1",
      ownerId: "mock-user-1",
      workItemId: "mock-wi-1",
      title: "Agent Harness 内容生产拆解",
      runtimeConfig: {
        node_id: "node-cloud-1",
        runtime_id: "api:qwen:qwen3.8-flash",
        driver_kind: "api",
        model: "qwen3.8-flash",
        thinking_effort: "low",
      },
      lastSeq: 3,
      archivedAt: null,
      createdAt: iso(-3600_000),
      updatedAt: iso(-120_000),
    })

    sessions.set(s2Id, {
      id: s2Id,
      organizationId: "mock-org-1",
      ownerId: "mock-user-1",
      workItemId: null,
      title: "选题灵感速记与大纲整理",
      runtimeConfig: {
        node_id: "node-cloud-1",
        runtime_id: "api:deepseek:deepseek-chat",
        driver_kind: "api",
        model: "deepseek-chat",
        thinking_effort: "off",
      },
      lastSeq: 2,
      archivedAt: null,
      createdAt: iso(-7200_000),
      updatedAt: iso(-1800_000),
    })

    const u1Id = "mock-msg-u1"
    messagesBySession.set(s1Id, [
      {
        id: u1Id,
        organizationId: "mock-org-1",
        sessionId: s1Id,
        seq: 1,
        role: "user",
        content: "帮我总结一下个人内容创作者引入生成-评估双循环的核心收益。",
        parts: [
          {
            type: "context_ref",
            kind: "work_item",
            id: "mock-wi-1",
            label: "为什么个人内容创作者需要 Agent Harness",
          },
        ],
        status: "completed",
        agentJobId: "mock-job-seed-1",
        replyToMessageId: null,
        createdAt: iso(-300_000),
      },
      {
        id: "mock-msg-a1-v1",
        organizationId: "mock-org-1",
        sessionId: s1Id,
        seq: 2,
        role: "assistant",
        content: "核心收益主要有两点：\n1. **事实边界**：通过预检减少无依据断言。\n2. **预算可控**：限制生成-评估轮数。",
        parts: [
          { type: "reasoning", text: "结合关联事项 Brief，归纳两项可验证的核心收益。" },
          {
            type: "text",
            text: "核心收益主要有两点：\n1. **事实边界**：通过预检减少无依据断言。\n2. **预算可控**：限制生成-评估轮数。",
          },
        ],
        status: "completed",
        agentJobId: "mock-job-seed-1",
        replyToMessageId: u1Id,
        runtimeLabel: "通义千问 Qwen 3.8 Flash",
        usage: {
          inputTokens: 120,
          outputTokens: 64,
          costCents: 0.1,
          durationMs: 820,
          model: "qwen3.8-flash",
        },
        createdAt: iso(-295_000),
      },
      {
        id: "mock-msg-a1-v2",
        organizationId: "mock-org-1",
        sessionId: s1Id,
        seq: 3,
        role: "assistant",
        content:
          "### 双循环出稿的三项关键价值\n\n- **指令与外部数据隔离**：避免信源文本里的提示词注入影响发布门禁。\n- **独立评估器把关**：由只读评估模型按清单核验信源引用。\n- **人保底终审**：AI 只写草稿，最终发布权留在人的点击。",
        parts: [
          { type: "reasoning", text: "补充指令数据分离与人保底终审两层结构，使建议更贴近星火工厂原则。" },
          {
            type: "text",
            text: "### 双循环出稿的三项关键价值\n\n- **指令与外部数据隔离**：避免信源文本里的提示词注入影响发布门禁。\n- **独立评估器把关**：由只读评估模型按清单核验信源引用。\n- **人保底终审**：AI 只写草稿，最终发布权留在人的点击。",
          },
        ],
        status: "completed",
        agentJobId: "mock-job-seed-2",
        replyToMessageId: u1Id,
        runtimeLabel: "DeepSeek Chat",
        usage: {
          inputTokens: 128,
          outputTokens: 96,
          costCents: 0.2,
          durationMs: 910,
          model: "deepseek-chat",
        },
        createdAt: iso(-120_000),
      },
    ])

    messagesBySession.set(s2Id, [
      {
        id: "mock-msg-s2-u1",
        organizationId: "mock-org-1",
        sessionId: s2Id,
        seq: 1,
        role: "user",
        content: "怎么把日常看到的零散链接变成可追踪选题？",
        parts: [],
        status: "completed",
        agentJobId: "mock-job-seed-3",
        replyToMessageId: null,
        createdAt: iso(-1850_000),
      },
      {
        id: "mock-msg-s2-a1",
        organizationId: "mock-org-1",
        sessionId: s2Id,
        seq: 2,
        role: "assistant",
        content:
          "可以直接在下方输入 `/capture 链接 + 备注` 一键存入收件箱，或用 `@` 关联已有事项继续展开大纲。",
        parts: [
          {
            type: "text",
            text: "可以直接在下方输入 `/capture 链接 + 备注` 一键存入收件箱，或用 `@` 关联已有事项继续展开大纲。",
          },
        ],
        status: "completed",
        agentJobId: "mock-job-seed-3",
        replyToMessageId: "mock-msg-s2-u1",
        runtimeLabel: "DeepSeek Chat",
        createdAt: iso(-1800_000),
      },
    ])
  }

  return {
    async listSessions(organizationId) {
      const list = [...sessions.values()].filter((s) => s.organizationId === organizationId)
      return sortSessionsDesc(list)
    },

    async createSession(input) {
      const id = nextId("mock-session")
      const ts = new Date().toISOString()
      const created: ChatSession = {
        id,
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        workItemId: input.workItemId ?? null,
        title: input.title ?? "",
        runtimeConfig: input.runtimeConfig ?? {},
        lastSeq: 0,
        archivedAt: null,
        createdAt: ts,
        updatedAt: ts,
      }
      sessions.set(id, created)
      messagesBySession.set(id, [])
      return { ...created }
    },

    async updateSession(sessionId, patch) {
      const existing = sessions.get(sessionId)
      if (!existing) throw new Error("会话不存在")
      const updated: ChatSession = {
        ...existing,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.workItemId !== undefined ? { workItemId: patch.workItemId } : {}),
        ...(patch.archivedAt !== undefined ? { archivedAt: patch.archivedAt } : {}),
        ...(patch.runtimeConfig !== undefined ? { runtimeConfig: patch.runtimeConfig } : {}),
        updatedAt: new Date().toISOString(),
      }
      sessions.set(sessionId, updated)
      return { ...updated }
    },

    async deleteSession(sessionId) {
      sessions.delete(sessionId)
      messagesBySession.delete(sessionId)
      activeJobsBySession.delete(sessionId)
    },

    async listMessages(sessionId) {
      return [...(messagesBySession.get(sessionId) ?? [])]
    },

    async cancelJob(jobId) {
      await cancelHandler(jobId)
    },

    async findActiveChatTurnJob(sessionId) {
      const job = activeJobsBySession.get(sessionId)
      return job ? { ...job } : null
    },

    insertUserMessage(input) {
      const s = sessions.get(input.sessionId)
      if (!s) throw new Error("会话不存在")
      const seq = s.lastSeq + 1
      const ts = new Date().toISOString()
      const title =
        s.title.trim() ||
        input.content
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 28)
      sessions.set(s.id, { ...s, lastSeq: seq, title, updatedAt: ts })

      const msg: ChatMessage = {
        id: nextId("mock-u"),
        organizationId: s.organizationId,
        sessionId: s.id,
        seq,
        role: "user",
        content: input.content,
        parts: input.parts ?? [],
        status: "completed",
        agentJobId: input.agentJobId ?? null,
        replyToMessageId: null,
        createdAt: ts,
      }
      const list = messagesBySession.get(s.id) ?? []
      list.push(msg)
      messagesBySession.set(s.id, list)
      return { ...msg }
    },

    appendAssistantMessage(input) {
      const s = sessions.get(input.sessionId)
      if (!s) throw new Error("会话不存在")
      const seq = s.lastSeq + 1
      const ts = new Date().toISOString()
      sessions.set(s.id, { ...s, lastSeq: seq, updatedAt: ts })

      const msg: ChatMessage = {
        id: nextId("mock-a"),
        organizationId: s.organizationId,
        sessionId: s.id,
        seq,
        role: "assistant",
        content: input.content,
        parts: input.parts,
        status: input.status,
        agentJobId: input.agentJobId,
        replyToMessageId: input.replyToMessageId,
        usage: input.usage ?? null,
        runtimeLabel: input.runtimeLabel ?? null,
        createdAt: ts,
      }
      const list = messagesBySession.get(s.id) ?? []
      list.push(msg)
      messagesBySession.set(s.id, list)
      return { ...msg }
    },

    getMessageById(sessionId, messageId) {
      return (messagesBySession.get(sessionId) ?? []).find((m) => m.id === messageId)
    },

    setCancelHandler(fn) {
      cancelHandler = fn
    },

    setActiveChatTurnJob(sessionId, job) {
      if (!job) {
        activeJobsBySession.delete(sessionId)
      } else {
        activeJobsBySession.set(sessionId, { ...job })
      }
    },
  }
}
