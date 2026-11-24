/**
 * Chat tool allowlist guard (docs/modules/chat.md 2.5). Tools are fixed functions, each calling one
 * specific RPC with the user's identity; the model never gets the user's JWT and there is no generic
 * RPC / SQL / HTTP tool. Approval, publishing and deletion stay human-only.
 */
import type { ChatToolSpec } from "./driver"

/** The MVP toolset (chat.md 4.2). Adding a tool means adding it here and to the chat-turn handler. */
export const CHAT_TOOL_ALLOWLIST = ["capture_intake", "read_work_item", "enqueue_content_draft"] as const
export type ChatToolName = (typeof CHAT_TOOL_ALLOWLIST)[number]

/** Tools that spend money or create work: the handler asks the user before running them. */
export const CHAT_TOOLS_REQUIRING_PERMISSION: readonly ChatToolName[] = ["enqueue_content_draft"]

const FORBIDDEN = /(approve|approval|publish|delete|remove|grant|revoke|mandate|sql|rpc|http|fetch|shell|exec)/i

export function assertSafeToolset(tools: readonly ChatToolSpec[]): void {
  const seen = new Set<string>()
  for (const t of tools) {
    if (!(CHAT_TOOL_ALLOWLIST as readonly string[]).includes(t.name)) {
      throw new Error(`工具 ${t.name} 不在 Chat 工具白名单内`)
    }
    if (FORBIDDEN.test(t.name)) throw new Error(`工具 ${t.name} 命中禁用动作`)
    if (seen.has(t.name)) throw new Error(`工具 ${t.name} 重复注册`)
    seen.add(t.name)
  }
}
