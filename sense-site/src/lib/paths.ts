const blockedPrefixes = ["/login", "/register", "/forgot-password"]

export function safeNextPath(value: string | null | undefined, fallback = "/me") {
  if (!value) return fallback
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback
  if (value.includes("\\") || value.includes("://")) return fallback
  if (blockedPrefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}?`))) {
    return fallback
  }
  return value
}
