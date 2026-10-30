export type Cursor = { publishedAt: string; id: string }

export function encodeCursor(publishedAt: string, id: string) {
  const bytes = new TextEncoder().encode(JSON.stringify([publishedAt, id]))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

export function decodeCursor(value: string): Cursor | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [publishedAt, id] = parsed
    if (typeof publishedAt !== "string" || typeof id !== "string") return null
    return { publishedAt, id }
  } catch {
    return null
  }
}
