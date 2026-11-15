/**
 * Controlled source fetcher for quick-capture links (worker only; browsers cannot fetch).
 * - http/https only, no embedded credentials, default ports only (80/443)
 * - every resolved address must be public: loopback, private, link-local, CGNAT, multicast,
 *   reserved and IPv4-mapped variants are refused. The check runs inside the socket `lookup`
 *   hook, so the address that is validated is the address that is connected (no DNS rebinding gap).
 * - redirects followed manually (≤3), each hop re-validated
 * - size cap, total timeout, text/html or text/plain only; HTML reduced to plain text
 * The returned text is UNTRUSTED data and is only ever placed in the untrusted Context Pack zone.
 */
import { lookup as dnsLookup } from "node:dns"
import http from "node:http"
import https from "node:https"
import { isIP, type LookupFunction } from "node:net"

export type FetchSourceResult =
  | { ok: true; url: string; finalUrl: string; title: string; text: string; contentType: string; bytes: number }
  | { ok: false; url: string; code: string; error: string }

export type SourceFetcher = (url: string, signal?: AbortSignal) => Promise<FetchSourceResult>

export const FETCH_LIMITS = { maxBytes: 2_000_000, timeoutMs: 10_000, maxRedirects: 3, maxTextChars: 12_000 } as const

export class FetchBlockedError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "FetchBlockedError"
    this.code = code
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]

function expandIpv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0]
  // embedded dotted IPv4 tail
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const n = ipv4ToInt(v4[1])
    addr = addr.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const halves = addr.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const groups = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail].map((g) => parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/** True when the address must never be fetched (non-public). Unknown formats are treated as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip.split("%")[0])
  if (family === 4) {
    const n = ipv4ToInt(ip)
    return BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)))
  }
  if (family !== 6) return true
  const g = expandIpv6(ip)
  if (!g) return true
  if (g.every((x) => x === 0)) return true // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96): judge the embedded IPv4
  const embedded = `${g[6] >>> 8}.${g[6] & 0xff}.${g[7] >>> 8}.${g[7] & 0xff}`
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isBlockedAddress(embedded)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedAddress(embedded)
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link local
  if ((g[0] & 0xffc0) === 0xfec0) return true // fec0::/10 site local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentation
  if (g[0] === 0x2002) return isBlockedAddress(`${g[1] >>> 8}.${g[1] & 0xff}.${g[2] >>> 8}.${g[2] & 0xff}`) // 6to4
  return false
}

/** Syntactic URL policy (before any network activity). Throws FetchBlockedError. */
export function assertFetchableUrl(raw: string, policy: { testOnlyAllowPort?: string } = {}): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new FetchBlockedError("invalid_url", "链接格式无效")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError("blocked_scheme", "只允许 http/https 链接")
  if (url.username || url.password) throw new FetchBlockedError("blocked_credentials", "链接不能内嵌账号密码")
  if (url.port && url.port !== policy.testOnlyAllowPort && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    throw new FetchBlockedError("blocked_port", "只允许默认端口")
  }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchBlockedError("blocked_host", "不允许访问本机或内网主机名")
  }
  if (isIP(host) && isBlockedAddress(host)) throw new FetchBlockedError("blocked_address", "不允许访问内网、本机或保留地址")
  return url
}

type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => dnsLookup(hostname, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))))

/** Socket lookup hook that refuses the connection if ANY resolved address is non-public. */
export function createSafeLookup(resolver: Resolver = systemResolver): LookupFunction {
  return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    resolver(hostname).then(
      (addrs) => {
        if (!addrs.length) return callback(new FetchBlockedError("dns_empty", "域名没有解析结果"))
        const bad = addrs.find((a) => isBlockedAddress(a.address))
        if (bad) return callback(new FetchBlockedError("blocked_address", "域名解析到内网、本机或保留地址"))
        if (options?.all) return callback(null, addrs)
        callback(null, addrs[0].address, addrs[0].family)
      },
      (error) => callback(error)
    )
  }) as LookupFunction
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

export function htmlToText(html: string): { title: string; text: string } {
  const decode = (s: string) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ""
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, 200)
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
  const text = decode(body)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
  return { title, text }
}

export interface FetchSourceResponse {
  status: number
  location: string | null
  contentType: string
  body: Buffer
}

export type FetchSourceTransport = (
  url: URL,
  lookup: LookupFunction,
  maxBytes: number,
  signal: AbortSignal
) => Promise<FetchSourceResponse>

export interface FetchSourceOptions {
  lookup?: LookupFunction
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  maxTextChars?: number
  /** Tests only: permit one non-default port (the local fixture server). */
  testOnlyAllowPort?: string
  /** Tests only: custom HTTP transport for environments where loopback sockets are blocked. */
  transport?: FetchSourceTransport
}

function requestOnce(url: URL, lookup: LookupFunction, maxBytes: number, signal: AbortSignal): Promise<FetchSourceResponse> {
  return new Promise<FetchSourceResponse>((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http
    const req = mod.request(url, {
      method: "GET",
      lookup,
      signal,
      headers: { "User-Agent": "SignalToStoryFetcher/1.0", Accept: "text/html,text/plain;q=0.9", "Accept-Encoding": "identity" },
    }, (res) => {
      const status = res.statusCode ?? 0
      const contentType = String(res.headers["content-type"] ?? "").toLowerCase()
      if (status >= 300 && status < 400) {
        res.resume()
        return resolve({ status, location: res.headers.location ?? null, contentType, body: Buffer.alloc(0) })
      }
      const declared = Number(res.headers["content-length"] ?? 0)
      if (declared > maxBytes) {
        res.destroy()
        return reject(new FetchBlockedError("too_large", `正文超过 ${maxBytes} 字节上限`))
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) {
          res.destroy()
          reject(new FetchBlockedError("too_large", `正文超过 ${maxBytes} 字节上限`))
          return
        }
        chunks.push(chunk)
      })
      res.on("end", () => resolve({ status, location: null, contentType, body: Buffer.concat(chunks) }))
      res.on("error", reject)
    })
    req.on("error", reject)
    req.end()
  })
}

/** Fetch a link and return plain text, or a structured failure (never throws). */
export async function fetchSourceText(rawUrl: string, signal?: AbortSignal, options: FetchSourceOptions = {}): Promise<FetchSourceResult> {
  const maxBytes = options.maxBytes ?? FETCH_LIMITS.maxBytes
  const lookup = options.lookup ?? createSafeLookup()
  const transport = options.transport ?? requestOnce
  const timeout = AbortSignal.timeout(options.timeoutMs ?? FETCH_LIMITS.timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const policy = { testOnlyAllowPort: options.testOnlyAllowPort }
    let url = assertFetchableUrl(rawUrl, policy)
    for (let hop = 0; ; hop++) {
      const res = await transport(url, lookup, maxBytes, combined)
      if (res.status >= 300 && res.status < 400) {
        if (!res.location) throw new FetchBlockedError("bad_redirect", "重定向缺少目标")
        if (hop >= (options.maxRedirects ?? FETCH_LIMITS.maxRedirects)) throw new FetchBlockedError("too_many_redirects", "重定向次数过多")
        url = assertFetchableUrl(new URL(res.location, url).toString(), policy)
        continue
      }
      if (res.status < 200 || res.status >= 300) throw new FetchBlockedError("http_status", `源站返回 HTTP ${res.status}`)
      const isHtml = res.contentType.includes("text/html") || res.contentType.includes("application/xhtml")
      if (!isHtml && !res.contentType.includes("text/plain")) throw new FetchBlockedError("unsupported_type", `不支持的内容类型 ${res.contentType || "未知"}`)
      const raw = res.body.toString("utf8")
      const parsed = isHtml ? htmlToText(raw) : { title: "", text: raw.trim() }
      const maxChars = options.maxTextChars ?? FETCH_LIMITS.maxTextChars
      if (!parsed.text) throw new FetchBlockedError("empty", "页面没有可提取的文字")
      return { ok: true, url: rawUrl, finalUrl: url.toString(), title: parsed.title, text: parsed.text.slice(0, maxChars), contentType: res.contentType, bytes: res.body.length }
    }
  } catch (error) {
    if (error instanceof FetchBlockedError) return { ok: false, url: rawUrl, code: error.code, error: error.message }
    const name = (error as { name?: string }).name
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, url: rawUrl, code: "timeout", error: "抓取超时" }
    const cause = (error as { cause?: unknown }).cause
    if (cause instanceof FetchBlockedError) return { ok: false, url: rawUrl, code: cause.code, error: cause.message }
    return { ok: false, url: rawUrl, code: "network", error: String((error as Error)?.message ?? error).slice(0, 300) }
  }
}

export const defaultSourceFetcher: SourceFetcher = (url, signal) => fetchSourceText(url, signal)
