import { Badge } from "@/components/ui/badge"
export function StatusBadge({ status }: { status: string }) {
  const variant = status === "异常" ? "destructive" : status === "已完成" ? "secondary" : "outline"
  return <Badge variant={variant}>{status}</Badge>
}
