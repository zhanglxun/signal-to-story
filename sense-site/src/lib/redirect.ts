/** Only same-origin absolute paths are accepted as post-login targets. */
export function safeRedirect(value: string | null | undefined, fallback = "/me") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback
  if (/^\/(login|register)(\/|\?|$)/.test(value)) return fallback
  return value
}
