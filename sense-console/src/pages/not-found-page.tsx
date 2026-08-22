import { Link } from "react-router"
import { Button } from "@/components/ui/button"
export function NotFoundPage() { return <main className="grid min-h-svh place-items-center bg-muted p-6"><div className="max-w-md rounded-xl border bg-card p-10 text-center shadow-sm"><p className="text-sm font-medium text-muted-foreground">404 · Lost signal</p><h1 className="mt-3 text-2xl font-semibold tracking-tight">这个故事线索不存在</h1><p className="mt-3 mb-7 text-sm text-muted-foreground">页面可能已移动，或者地址输入有误。</p><Button nativeButton={false} render={<Link to="/dashboard" />}>返回驾驶舱</Button></div></main> }
