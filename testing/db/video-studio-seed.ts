/** Shared PGlite fixtures for the video studio (DB tests, worker e2e test and `npm run demo:video`). */
import { type SupabaseTestDb, seedOrganization } from "./pglite-harness"

export interface VideoWorkspace {
  organizationId: string
  ownerId: string
  memberId: string
  viewerId: string
}

export async function seedVideoWorkspace(db: SupabaseTestDb): Promise<VideoWorkspace> {
  const org = await seedOrganization(db, {
    members: [
      { role: "owner", permissions: ["content.view", "content.manage", "content.review", "content.publish", "agent.dispatch", "agent.approve", "account.manage"] },
      { role: "member", permissions: ["content.view", "content.manage", "agent.dispatch"] },
      { role: "viewer" },
    ],
  })
  return { organizationId: org.organizationId, ownerId: org.members.owner, memberId: org.members.member, viewerId: org.members.viewer }
}

export interface DemoShotInput {
  motion_mode?: "local_ken_burns" | "cloud_video_model"
  narration?: string
  target_duration_ms?: number
}

/** Create a plan with shots directly (as the given user). Returns plan id and shot ids in order. */
export async function createPlanWithShots(db: SupabaseTestDb, ws: VideoWorkspace, shots: DemoShotInput[], userId = ws.ownerId) {
  return db.asUser(userId, async (tx) => {
    const plan = await tx.query<{ id: string }>(
      "insert into public.video_plans(organization_id, title, created_by) values ($1, $2, $3) returning id",
      [ws.organizationId, "测试视频", userId]
    )
    const planId = plan.rows[0].id
    const ids: string[] = []
    for (const [index, shot] of shots.entries()) {
      const r = await tx.query<{ id: string }>(
        `insert into public.video_shots(organization_id, plan_id, position, motion_mode, narration, target_duration_ms, visual_prompt, created_by)
         values ($1,$2,$3,$4,$5,$6,'画面',$7) returning id`,
        [ws.organizationId, planId, index + 1, shot.motion_mode ?? "local_ken_burns", shot.narration ?? `第 ${index + 1} 句旁白`, shot.target_duration_ms ?? 4000, userId]
      )
      ids.push(r.rows[0].id)
    }
    return { planId, shotIds: ids }
  })
}

export async function planRevision(db: SupabaseTestDb, planId: string): Promise<number> {
  return db.asPostgres(async (tx) => (await tx.query<{ revision: number }>("select revision from public.video_plans where id=$1", [planId])).rows[0].revision)
}
