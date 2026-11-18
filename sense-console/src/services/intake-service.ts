import { intakeEventSchema, manualInputSchema, titleFromInput, workItemSchema, type IntakeEvent } from '@/contracts/work-item'
import { db, fail } from '@/services/content-service'

const parse = (rows: unknown[] | null) => (rows ?? []).map(row => intakeEventSchema.parse(row))

/** 收件箱：还没归到事项、也没被忽略的输入，最新的在前。 */
export async function listInbox(org: string, page: number, pageSize: number) {
  const from = (page - 1) * pageSize
  const { data, error, count } = await db().from('intake_events').select('*', { count: 'exact' })
    .eq('organization_id', org).is('work_item_id', null).is('ignored_at', null)
    .order('created_at', { ascending: false }).order('id').range(from, from + pageSize - 1)
  fail(error)
  return { events: parse(data), totalCount: count ?? 0 }
}

/** 最近从外部连接（IM / 接口）进来的输入，供「外部接入」页核对。 */
export async function listRecentExternalInputs(org: string, limit = 50) {
  const { data, error } = await db().from('intake_events').select()
    .eq('organization_id', org).not('connection_id', 'is', null)
    .order('created_at', { ascending: false }).limit(limit)
  fail(error); return parse(data)
}

/** 手动记一条输入。只能经 record_intake_event RPC 写入；external_id 是客户端幂等键。 */
export async function recordManualInput(org: string, input: { text: string; url: string }) {
  const value = manualInputSchema.parse(input)
  const { data, error } = await db().rpc('record_intake_event', {
    p_organization_id: org, p_source: 'web', p_external_id: globalThis.crypto.randomUUID(),
    p_text: value.text, p_url: value.url || null, p_payload: {}, p_connection_id: null,
  })
  fail(error); return intakeEventSchema.parse(data)
}

async function file(event: Pick<IntakeEvent, 'id'>, workItemId: string) {
  const { data, error } = await db().from('intake_events').update({ work_item_id: workItemId })
    .eq('id', event.id).is('work_item_id', null).select('id')
  fail(error); if (!data?.length) throw new Error('这条输入已被处理，请刷新后查看。')
}

/** 转为事项：新建一张卡（标题取输入第一行，brief 带原文和链接）并把输入归进去，一个事务完成。 */
export async function promoteInput(event: IntakeEvent) {
  const { data, error } = await db().rpc('promote_intake_event', { p_event_id: event.id, p_title: titleFromInput(event) })
  fail(error); return workItemSchema.parse(data)
}

/** 归入已有事项。 */
export function attachInput(event: Pick<IntakeEvent, 'id'>, workItemId: string) {
  return file(event, workItemId)
}

export async function ignoreInput(event: Pick<IntakeEvent, 'id'>) {
  const { data, error } = await db().from('intake_events').update({ ignored_at: new Date().toISOString() })
    .eq('id', event.id).is('work_item_id', null).is('ignored_at', null).select('id')
  fail(error); if (!data?.length) throw new Error('这条输入已被处理，请刷新后查看。')
}
