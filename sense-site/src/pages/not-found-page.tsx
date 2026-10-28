import { NotFoundState } from "@/components/site/page-state"
import { usePageTitle } from "@/lib/use-page-title"

export function NotFoundPage() {
  usePageTitle("找不到页面")
  return <NotFoundState />
}
