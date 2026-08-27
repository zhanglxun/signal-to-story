import { useMemo, useState } from "react"

/**
 * Client-side pagination over an already-loaded array. `page` is clamped
 * into `[1, pageCount]` on every render (derived, not stored), so filtering
 * or switching context (e.g. a different story) that shrinks the list never
 * strands the caller on an out-of-range page — no effect-based reset needed.
 */
export function usePagination<T>(items: T[], pageSize: number) {
  const [requestedPage, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(Math.max(requestedPage, 1), pageCount)

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  )

  return { page, pageCount, pageItems, setPage, totalCount: items.length }
}
