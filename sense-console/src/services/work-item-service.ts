import type { ContentDocument, Platform } from '@/contracts/content'
import {
  intakeEventSchema, mergeBrief, workItemInputSchema, workItemSchema,
  type IntakeEvent, type WorkItem, type WorkItemBrief, type WorkItemInput, type WorkItemStatus,
} from '@/contracts/work-item'
import { allRows, db, fail } from '@/services/content-service'

const parseItem = (row: unknown) => workItemSchema.parse(row)

export async function listWorkItems(org: string): Promise<WorkItem[]> {
  return (await allRows<unknown>('work_items', org, 'updated_at')).map(parseItem)
}

export async function getWorkItem(id: string): Promise<WorkItem> {
  const { data, error } = await db().from('work_items').select().eq('id', id).single()
  fail(error); return parseItem(data)
}

/** Insert a card. created_by / created_at / updated_at are set by the database. */
export async function insertWorkItem(org: string, values: { title: string; kind: WorkItem['kind']; brief: WorkItemBrief; category_id?: number | null; status?: WorkItemStatus }) {
  const { data, error } = await db().from('work_items').insert({
    organization_id: org, title: values.title, kind: values.kind, brief: values.brief,
    category_id: values.category_id ?? null, status: values.status ?? 'todo',
  }).select().single()
  fail(error); return parseItem(data)
}

export async function createWorkItem(org: string, input: WorkItemInput) {
  const value = workItemInputSchema.parse(input)
  return insertWorkItem(org, { title: value.title, kind: value.kind, category_id: value.category_id, brief: mergeBrief({}, value) })
}

async function guardedUpdate(item: Pick<WorkItem, 'id' | 'updated_at'>, patch: Record<string, unknown>) {
  const { data, error } = await db().from('work_items').update(patch).eq('id', item.id).eq('updated_at', item.updated_at).select().maybeSingle()
  fail(error); if (!data) throw new Error('事项已被其他成员修改，请刷新后重试。')
  return parseItem(data)
}

/** Optimistic update: fails if the card changed since it was read. Unknown brief keys are preserved. */
export function updateWorkItem(item: WorkItem, input: WorkItemInput) {
  const value = workItemInputSchema.parse(input)
  return guardedUpdate(item, { title: value.title, kind: value.kind, category_id: value.category_id, brief: mergeBrief(item.brief, value) })
}

export function setWorkItemStatus(item: WorkItem, status: WorkItemStatus) {
  return guardedUpdate(item, { status })
}

export async function listWorkItemDocuments(workItemId: string) {
  const { data, error } = await db().from('content_documents').select().eq('work_item_id', workItemId).order('created_at')
  fail(error); return (data ?? []) as ContentDocument[]
}

/** New documents belong to a work item (never project_id). A platform copy starts from the master's text. */
export async function createWorkItemDocument(item: Pick<WorkItem, 'id' | 'organization_id' | 'title'>, platform: Platform | 'master', source?: ContentDocument) {
  const { data, error } = await db().from('content_documents').insert({
    organization_id: item.organization_id, work_item_id: item.id, platform,
    title: source?.title ?? item.title, body: source?.body ?? '',
  }).select().single()
  fail(error); return data as ContentDocument
}

/** The inputs (intake_events) that were filed into this item, oldest first. */
export async function listWorkItemInputs(workItemId: string): Promise<IntakeEvent[]> {
  const { data, error } = await db().from('intake_events').select().eq('work_item_id', workItemId).order('created_at').limit(200)
  fail(error); return (data ?? []).map(row => intakeEventSchema.parse(row))
}
