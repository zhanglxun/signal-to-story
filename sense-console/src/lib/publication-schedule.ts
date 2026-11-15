import type { Publication } from '@/contracts/content'

export type ScheduleGroup = { date: string; items: Publication[] }

/** Planned or invalidated plans only, grouped by local calendar date, oldest first. A plan is a record, never an auto-publish trigger. */
export function groupSchedule(publications: Publication[]): ScheduleGroup[] {
  const groups = new Map<string, Publication[]>()
  for (const p of publications) {
    if (p.status === 'published' || (p.status === 'cancelled' && !p.invalidated_at)) continue
    const d = new Date(p.scheduled_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, items: items.sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at)) }))
}

export function isInvalidatedPlan(p: Pick<Publication, 'status' | 'invalidated_at'>) {
  return p.status === 'cancelled' && Boolean(p.invalidated_at)
}
