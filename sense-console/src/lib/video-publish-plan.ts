import type { ContentDocument, PublishingChannel } from "@/contracts/content"

export interface VideoPublishCandidate {
  document: ContentDocument
  channels: PublishingChannel[]
}

export type VideoPublishEligibility =
  | { ok: true; candidates: VideoPublishCandidate[] }
  | { ok: false; reason: string }

/**
 * Which approved platform drafts of the plan's content project can carry the composed video into a planned publication.
 * Mirrors the database guard (approved latest revision, channel platform must match) so the UI can explain why it is disabled.
 */
export function videoPublishEligibility(input: {
  projectId: string | null
  composedVideoAssetId: number | null
  documents: readonly ContentDocument[]
  channels: readonly PublishingChannel[]
}): VideoPublishEligibility {
  if (!input.projectId) return { ok: false, reason: "该分镜方案未关联内容项目，无法确定要发布的稿件。" }
  if (input.composedVideoAssetId == null) return { ok: false, reason: "成片尚未合成，合成完成后才能加入发布计划。" }
  const approved = input.documents.filter((d) => d.project_id === input.projectId && d.status === "approved")
  if (approved.length === 0) return { ok: false, reason: "关联的内容项目下没有已审核通过的平台稿，请先完成稿件审核。" }
  const candidates = approved
    .map((document) => ({ document, channels: input.channels.filter((c) => c.platform === document.platform) }))
    .filter((c) => c.channels.length > 0)
  if (candidates.length === 0) return { ok: false, reason: "已审核稿件对应的平台尚未登记发布账号，请先在发布管理中添加账号。" }
  return { ok: true, candidates }
}
