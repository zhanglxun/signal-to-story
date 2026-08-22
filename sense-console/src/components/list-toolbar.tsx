import { Filter, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function ListToolbar({ placeholder, action }: { placeholder: string; action: string }) {
  return <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center"><div className="relative flex-1"><Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder={placeholder} /></div><Button variant="outline"><Filter />筛选</Button><Button>{action}</Button></div>
}
