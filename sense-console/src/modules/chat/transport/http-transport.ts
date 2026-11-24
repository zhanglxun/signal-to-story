import { getSupabaseClient } from "@/lib/supabase"
import { parseSseStream } from "@/modules/chat/transport/sse-parser"
import type { ChatTransport, ChatTurnTarget } from "@/modules/chat/transport/transport"
import {
  type AnswerPermissionRequest,
  type ChatStreamEvent,
  type HealthResponse,
  HttpTransportError,
  type RegenerateTurnRequest,
  type SendTurnRequest,
} from "@/modules/chat/types"

function normalizeBaseUrl(endpointHint: string): string {
  return endpointHint.trim().replace(/\/+$/, "")
}

async function resolveAccessToken(): Promise<string> {
  const client = getSupabaseClient()
  if (!client) {
    throw new HttpTransportError(401, "unauthorized", "Supabase 未配置，无法获取用户登录凭证")
  }
  const { data, error } = await client.auth.getSession()
  const token = data.session?.access_token
  if (error || !token) {
    throw new HttpTransportError(401, "unauthorized", "登录状态已失效，请重新登录后再试")
  }
  return token
}

async function parsePreStreamError(response: Response): Promise<HttpTransportError> {
  let code = `http_${response.status}`
  let message = `节点请求失败 (HTTP ${response.status})`
  try {
    const json = (await response.json()) as { code?: unknown; message?: unknown; error?: unknown } | null
    if (json && typeof json === "object") {
      if (typeof json.code === "string" && json.code.trim()) code = json.code.trim()
      if (typeof json.message === "string" && json.message.trim()) message = json.message.trim()
      else if (typeof json.error === "string" && json.error.trim()) message = json.error.trim()
    }
  } catch {
    // Ignore invalid JSON error bodies and keep status fallback.
  }
  return new HttpTransportError(response.status, code, message)
}

export function createHttpChatTransport(fetchImpl: typeof fetch = fetch): ChatTransport {
  async function* postSse(
    target: ChatTurnTarget,
    path: string,
    payload: unknown,
    signal?: AbortSignal
  ): AsyncGenerator<ChatStreamEvent, void, void> {
    const baseUrl = normalizeBaseUrl(target.endpointHint)
    if (!baseUrl) {
      throw new HttpTransportError(503, "runtime_unavailable", "当前所选节点未配置 HTTP 地址")
    }
    const token = await resolveAccessToken()
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal,
    })

    if (!response.ok) {
      throw await parsePreStreamError(response)
    }
    if (!response.body) {
      throw new HttpTransportError(503, "runtime_unavailable", "节点未返回有效的流式响应体")
    }

    yield* parseSseStream(response.body, signal)
  }

  return {
    mode: "http",

    sendTurn(target: ChatTurnTarget, body: SendTurnRequest, signal?: AbortSignal) {
      return postSse(target, "/v1/chat/turns", body, signal)
    },

    regenerate(target: ChatTurnTarget, body: RegenerateTurnRequest, signal?: AbortSignal) {
      return postSse(target, "/v1/chat/turns/regenerate", body, signal)
    },

    async answerPermission(
      target: ChatTurnTarget,
      jobId: string,
      requestId: string,
      body: AnswerPermissionRequest,
      signal?: AbortSignal
    ): Promise<void> {
      const baseUrl = normalizeBaseUrl(target.endpointHint)
      if (!baseUrl) {
        throw new HttpTransportError(503, "runtime_unavailable", "当前所选节点未配置 HTTP 地址")
      }
      const token = await resolveAccessToken()
      const response = await fetchImpl(
        `${baseUrl}/v1/chat/turns/${encodeURIComponent(jobId)}/permissions/${encodeURIComponent(requestId)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        }
      )
      if (!response.ok) {
        throw await parsePreStreamError(response)
      }
    },

    async checkHealth(endpointHint: string, signal?: AbortSignal): Promise<HealthResponse> {
      const baseUrl = normalizeBaseUrl(endpointHint)
      const response = await fetchImpl(`${baseUrl}/v1/health`, { method: "GET", signal })
      if (!response.ok) {
        throw await parsePreStreamError(response)
      }
      return (await response.json()) as HealthResponse
    },
  }
}
