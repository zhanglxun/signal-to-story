import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

function getPageNumbers(page: number, pageCount: number): (number | "ellipsis")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)

  const keep = new Set([1, pageCount, page - 1, page, page + 1])
  const sorted = [...keep].filter((candidate) => candidate >= 1 && candidate <= pageCount).sort((a, b) => a - b)

  const result: (number | "ellipsis")[] = []
  sorted.forEach((candidate, index) => {
    if (index > 0 && candidate - sorted[index - 1] > 1) result.push("ellipsis")
    result.push(candidate)
  })
  return result
}

/**
 * Shared pagination control for list/grid pages. Purely presentational —
 * pair it with `usePagination` for the slicing logic, or with a
 * server-paginated query's own page/pageCount state.
 *
 * Always renders, even when there is only one page: previous/next are
 * disabled and the summary line still reports the total count, so the
 * control is a reliable signal that pagination is wired up rather than
 * disappearing whenever the current dataset happens to fit on one page.
 */
export function PaginationBar({
  page,
  pageCount,
  totalCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  totalCount?: number
  onPageChange: (page: number) => void
}) {
  const goTo = (target: number) => {
    if (target >= 1 && target <= pageCount && target !== page) onPageChange(target)
  }

  return (
    <div className="flex flex-col items-center gap-3 border-t pt-4 sm:flex-row sm:justify-between">
      {typeof totalCount === "number" && (
        <p className="text-xs text-muted-foreground">
          共 {totalCount} 条 · 第 {page}/{pageCount} 页
        </p>
      )}
      <Pagination className="mx-0 w-fit sm:ml-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              text="上一页"
              href="#"
              aria-disabled={page <= 1}
              className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
              onClick={(event) => {
                event.preventDefault()
                goTo(page - 1)
              }}
            />
          </PaginationItem>
          {getPageNumbers(page, pageCount).map((item, index) =>
            item === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${index}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <PaginationLink
                  href="#"
                  isActive={item === page}
                  onClick={(event) => {
                    event.preventDefault()
                    goTo(item)
                  }}
                >
                  {item}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              text="下一页"
              href="#"
              aria-disabled={page >= pageCount}
              className={page >= pageCount ? "pointer-events-none opacity-50" : undefined}
              onClick={(event) => {
                event.preventDefault()
                goTo(page + 1)
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
