import type { MandateActionType, MandateGateCheckInput, MandateGateCheckResult } from "./contracts/agent-harness"

export const MANDATE_REQUIRED_ACTIONS: ReadonlySet<MandateActionType> = new Set([
  "publish_external",
  "publish_site",
  "paid_video_render",
  "rotate_credentials",
  "delete_project",
  "change_org_permissions",
])

/** Job types that the database refuses to queue/run without an approved approval_request. */
export const MANDATE_GATED_JOB_TYPES: Readonly<Record<string, MandateActionType>> = {
  publish_external: "publish_external",
  publish_site: "publish_site",
  video_render: "paid_video_render",
}

/**
 * UI-side ADVISORY check only (disable buttons, explain why).
 * The authority is the database: approval_requests + decide_approval_request() +
 * the agent_jobs Mandate trigger + publish_document (MD001 / MD002).
 */
export function checkMandateGate(input: MandateGateCheckInput): MandateGateCheckResult {
  const requiresHuman = MANDATE_REQUIRED_ACTIONS.has(input.action)
  if (input.actorType === "agent") {
    return {
      allowed: false,
      requiresHumanApproval: true,
      reason: `动作 [${input.action}] 属于高风险人工门禁类别，Agent 仅可提交待审请求，不得自行批准或执行。`,
    }
  }
  if (!requiresHuman) return { allowed: true, requiresHumanApproval: false, reason: "该动作无需人工批准。" }
  if (!input.humanApprovalId || !input.humanApprovalId.trim()) {
    return { allowed: false, requiresHumanApproval: true, reason: `动作 [${input.action}] 缺少有效的人工批准签名 (humanApprovalId)。` }
  }
  if (input.targetRevision != null && input.approvedRevision !== input.targetRevision) {
    return {
      allowed: false,
      requiresHumanApproval: true,
      reason: `稿件或分镜版本已发生变更（已批准版本 v${input.approvedRevision ?? "?"} !== 当前目标版本 v${input.targetRevision}），旧批准已自动失效，请重新审核。`,
    }
  }
  return { allowed: true, requiresHumanApproval: true, reason: "界面预检通过（最终以数据库门禁为准）。" }
}
