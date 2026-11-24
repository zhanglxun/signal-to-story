import type {
  AnswerPermissionRequest,
  ChatStreamEvent,
  HealthResponse,
  RegenerateTurnRequest,
  SendTurnRequest,
} from "@/modules/chat/types"

export interface ChatTurnTarget {
  endpointHint: string
  nodeId: string
}

export interface ChatTransport {
  readonly mode: "http" | "mock"
  sendTurn(
    target: ChatTurnTarget,
    body: SendTurnRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamEvent>
  regenerate(
    target: ChatTurnTarget,
    body: RegenerateTurnRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamEvent>
  answerPermission(
    target: ChatTurnTarget,
    jobId: string,
    requestId: string,
    body: AnswerPermissionRequest,
    signal?: AbortSignal
  ): Promise<void>
  checkHealth?(endpointHint: string, signal?: AbortSignal): Promise<HealthResponse>
}

export function isMockChatMode(): boolean {
  return import.meta.env.VITE_CHAT_TRANSPORT === "mock"
}
