import { Link } from "react-router"

import { Button } from "@/components/ui/button"
import { usePageTitle } from "@/hooks/use-page-title"

export function NotFoundPage({ message = "你访问的页面不存在，或内容已经下线。" }: { message?: string }) {
  usePageTitle("页面不存在")
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <p className="text-5xl font-semibold tracking-tight text-muted-foreground/60">404</p>
      <h1 className="text-xl font-semibold">页面不存在</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="flex gap-2">
        <Button nativeButton={false} render={<Link to="/" />}>回到首页</Button>
        <Button variant="outline" nativeButton={false} render={<Link to="/explore" />}>探索内容</Button>
      </div>
    </div>
  )
}
