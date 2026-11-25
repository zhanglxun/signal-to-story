import { z } from "zod"

import { db, fail } from "@/services/content-service"

/** A node is "online" when it called the database within this window (it polls every few seconds). */
export const NODE_ONLINE_WINDOW_MS = 2 * 60 * 1000

export const runnerNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  revoked_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
})
export type RunnerNode = z.infer<typeof runnerNodeSchema>

export type NodeState = "online" | "offline" | "never" | "revoked"
export function nodeState(node: RunnerNode, now = Date.now()): NodeState {
  if (node.revoked_at) return "revoked"
  if (!node.last_seen_at) return "never"
  return now - new Date(node.last_seen_at).getTime() <= NODE_ONLINE_WINDOW_MS ? "online" : "offline"
}

export async function listRunnerNodes(org: string) {
  const { data, error } = await db().from("runner_nodes").select("id,name,revoked_at,last_seen_at,created_at")
    .eq("organization_id", org).order("created_at", { ascending: false })
  fail(error); return (data ?? []).map((row) => runnerNodeSchema.parse(row))
}

/** Returns the plain token once; the database keeps only its hash. */
export async function createRunnerNode(org: string, name: string) {
  const { data, error } = await db().rpc("create_runner_node", { p_organization_id: org, p_name: name.trim() })
  fail(error); return z.object({ id: z.string(), name: z.string(), token: z.string() }).parse(data)
}

export async function revokeRunnerNode(id: string) {
  const { error } = await db().rpc("revoke_runner_node", { p_node_id: id })
  fail(error)
}
