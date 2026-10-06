export type IntakeInput = {
  version: 1
  intent: "capture"
  external_id: string
  text: string
  title: string
  url: string
  angle: string
}
export function normalizeIntake(value: unknown): IntakeInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("请求必须是 JSON 对象")
  const v = value as Record<string, unknown>
  const keys = [
    "version",
    "intent",
    "external_id",
    "text",
    "title",
    "url",
    "angle",
  ]
  if (Object.keys(v).some((k) => !keys.includes(k)))
    throw new Error("存在不支持的字段；组织和身份由接入凭证确定")
  if (v.version !== 1 || v.intent !== "capture")
    throw new Error("本入口仅支持 version=1、intent=capture（收录选题）")
  const field = (name: string, max: number, required = false) => {
    if (v[name] === undefined && !required) return ""
    if (typeof v[name] !== "string") throw new Error(`${name} 必须是文字`)
    const s = (v[name] as string).trim()
    if ((required && !s) || Array.from(s).length > max)
      throw new Error(`${name} 长度无效（最多 ${max} 字）`)
    return s
  }
  const text = field("text", 4000, true)
  const url = field("url", 512)
  if (url) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error("url 必须是完整的 HTTP(S) 链接")
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("url 不支持该协议或内嵌凭证")
  }
  // URL is stored as evidence only: no fetch, redirects or server-side browser work.
  return {
    version: 1,
    intent: "capture",
    external_id: field("external_id", 128, true),
    text,
    title:
      field("title", 64) ||
      Array.from(text.replace(/\s+/g, " ")).slice(0, 64).join(""),
    url,
    angle: field("angle", 512),
  }
}
