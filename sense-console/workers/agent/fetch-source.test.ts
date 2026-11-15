// @vitest-environment node
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { assertFetchableUrl, createSafeLookup, fetchSourceText, htmlToText, isBlockedAddress } from "./fetch-source"

describe("SSRF address policy", () => {
  it.each([
    "127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "::ffff:169.254.169.254", "64:ff9b::a00:1", "2002:7f00:1::", "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true))

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(false))

  it("rejects unsafe URLs before any network access", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com", "http://user:pw@example.com/", "http://localhost/", "http://a.localhost/",
      "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://example.com:8080/", "gopher://x", "not a url"]) {
      expect(() => assertFetchableUrl(url), url).toThrow()
    }
    expect(assertFetchableUrl("https://example.com/a?b=1").hostname).toBe("example.com")
  })

  it("lookup hook refuses hostnames that resolve to private addresses (DNS rebinding)", async () => {
    const lookup = createSafeLookup(async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }])
    const err = await new Promise((resolve) => (lookup as unknown as (h: string, o: object, cb: (e: unknown) => void) => void)("evil.example", {}, resolve))
    expect(err).toMatchObject({ code: "blocked_address" })
  })
})

describe("fetchSourceText", () => {
  let server: Server
  let port = 0
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/page") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end("<html><head><title>T &amp; T</title><script>alert(1)</script></head><body><p>第一段</p><p>第二段 &lt;b&gt;</p></body></html>")
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" })
        res.end("x".repeat(5000))
      } else if (req.url === "/bin") {
        res.writeHead(200, { "content-type": "application/octet-stream" })
        res.end("bin")
      } else if (req.url === "/redirect-internal") {
        res.writeHead(302, { location: "http://127.0.0.1/secret" })
        res.end()
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  // Test-only: route the public-looking hostname to the loopback fixture (the safe lookup would refuse it).
  const toFixture = ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
    opts?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)) as never
  const viaFixture = (path: string, extra: Parameters<typeof fetchSourceText>[2] = {}) =>
    fetchSourceText(`http://fixture.example:${port}${path}`, undefined, { lookup: toFixture, testOnlyAllowPort: String(port), ...extra })

  it("default policy blocks the loopback server and non-default ports", async () => {
    expect(await fetchSourceText(`http://127.0.0.1:${port}/page`)).toMatchObject({ ok: false, code: "blocked_port" })
    expect(await fetchSourceText(`http://127.0.0.1/page`)).toMatchObject({ ok: false, code: "blocked_address" })
    // Hostname resolving to loopback via the real safe lookup is refused at connect time.
    const lookup = createSafeLookup(async () => [{ address: "127.0.0.1", family: 4 }])
    expect(await fetchSourceText(`http://fixture.example:${port}/page`, undefined, { lookup, testOnlyAllowPort: String(port) })).toMatchObject({ ok: false, code: "blocked_address" })
  })

  it("extracts plain text from HTML without scripts", async () => {
    const r = await viaFixture("/page")
    expect(r).toMatchObject({ ok: true, title: "T & T", text: "第一段\n第二段 <b>" })
  })

  it("enforces size, content type, status and redirect re-validation", async () => {
    expect(await viaFixture("/big", { maxBytes: 1000 })).toMatchObject({ ok: false, code: "too_large" })
    expect(await viaFixture("/bin")).toMatchObject({ ok: false, code: "unsupported_type" })
    expect(await viaFixture("/missing")).toMatchObject({ ok: false, code: "http_status" })
    expect(await viaFixture("/redirect-internal")).toMatchObject({ ok: false, code: "blocked_address" })
    expect(await viaFixture("/big", { maxTextChars: 10 })).toMatchObject({ ok: true, text: "xxxxxxxxxx" })
  })

  it("htmlToText decodes entities and drops non-content blocks", () => {
    expect(htmlToText("<title>A&#x26;B</title><noscript>n</noscript><div>x&nbsp;y</div>")).toEqual({ title: "A&B", text: "x y" })
  })
})
