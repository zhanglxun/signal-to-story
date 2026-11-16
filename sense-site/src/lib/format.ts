export function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date)
}

export function formatBytes(size: number | null) {
  if (size == null) return ""
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function safeStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}
