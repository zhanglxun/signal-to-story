export type NavItem = {
  id: "home" | "explore" | "topics" | "resources" | "me"
  label: string
  to: string
}

export const primaryNav = [
  { id: "home", label: "首页", to: "/" },
  { id: "explore", label: "探索", to: "/explore" },
  { id: "topics", label: "专题", to: "/topics" },
  { id: "resources", label: "资源库", to: "/resources" },
  { id: "me", label: "我的", to: "/me" },
] as const satisfies readonly NavItem[]

export function activeNavId(pathname: string): NavItem["id"] | null {
  if (pathname === "/") return "home"
  if (pathname === "/explore" || pathname.startsWith("/explore/") || pathname.startsWith("/content/")) {
    return "explore"
  }
  if (pathname === "/topics" || pathname.startsWith("/topics/")) return "topics"
  if (pathname === "/resources" || pathname.startsWith("/resources/")) return "resources"
  if (pathname === "/me" || pathname.startsWith("/me/")) return "me"
  return null
}
