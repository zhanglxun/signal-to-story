import { describe, expect, it } from "vitest"
import {
  ALLOWED_ENV_KEYS,
  CLI_SPECS,
  buildChildEnv,
  buildEnvUpdates,
  constantTimeEqual,
  resolveChatBaseUrl,
  validateBaseUrl,
  validateBridgeRequest,
  validateEnvValue,
  validatePrompt,
} from "../../dev/local-bridge-guard"

const TOKEN = "t0ken"
const okHeaders = {
  host: "localhost:5173",
  origin: "http://localhost:5173",
  "content-type": "application/json",
  "x-sense-bridge-token": TOKEN,
}
const req = (
  over: Partial<Parameters<typeof validateBridgeRequest>[0]> & {
    headers?: Record<string, string | undefined>
  } = {}
) =>
  validateBridgeRequest({
    method: "POST",
    url: "/__sense_bridge/chat",
    remoteAddress: "127.0.0.1",
    token: TOKEN,
    ...over,
    headers: { ...okHeaders, ...over.headers },
  })

describe("validateBridgeRequest", () => {
  it("accepts a valid same-origin POST", () => {
    expect(req().ok).toBe(true)
    expect(req({ remoteAddress: "::1" }).ok).toBe(true)
    expect(req({ remoteAddress: "::ffff:127.0.0.1" }).ok).toBe(true)
  })
  it("rejects non-loopback peers", () => {
    expect(req({ remoteAddress: "192.168.1.5" })).toMatchObject({ status: 403 })
    expect(req({ remoteAddress: undefined })).toMatchObject({ status: 403 })
  })
  it("rejects forged Host (DNS rebinding)", () => {
    const r = req({ headers: { host: "evil.example.com", origin: undefined } })
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect(req({ headers: { host: "localhost.evil.com" } }).ok).toBe(false)
    expect(req({ headers: { host: undefined } }).ok).toBe(false)
  })
  it("allows loopback Host variants", () => {
    for (const h of ["127.0.0.1:5173", "[::1]:5173", "localhost"]) {
      expect(
        req({ headers: { host: h, origin: undefined } }).ok
      ).toBe(true)
    }
  })
  it("rejects cross-origin Origin", () => {
    expect(req({ headers: { origin: "https://evil.com" } })).toMatchObject({
      status: 403,
    })
    expect(req({ headers: { origin: "http://localhost:9999" } }).ok).toBe(false)
    expect(req({ headers: { origin: "null" } }).ok).toBe(false)
  })
  it("rejects cross-site Sec-Fetch-Site", () => {
    expect(req({ headers: { "sec-fetch-site": "cross-site" } }).ok).toBe(false)
    expect(req({ headers: { "sec-fetch-site": "same-origin" } }).ok).toBe(true)
  })
  it("requires application/json on POST", () => {
    expect(
      req({ headers: { "content-type": "text/plain" } })
    ).toMatchObject({ status: 415 })
    expect(req({ headers: { "content-type": undefined } }).ok).toBe(false)
    expect(
      req({ headers: { "content-type": "application/json; charset=utf-8" } }).ok
    ).toBe(true)
  })
  it("requires a matching token on POST", () => {
    expect(req({ headers: { "x-sense-bridge-token": undefined } })).toMatchObject({
      status: 403,
    })
    expect(req({ headers: { "x-sense-bridge-token": "wrong" } }).ok).toBe(false)
  })
  it("allows GET without token/content-type but not other methods", () => {
    const get = validateBridgeRequest({
      method: "GET",
      url: "/__sense_bridge/status",
      remoteAddress: "127.0.0.1",
      token: TOKEN,
      headers: { host: "localhost:5173" },
    })
    expect(get.ok).toBe(true)
    expect(req({ method: "PUT" })).toMatchObject({ status: 405 })
  })
})

describe("constantTimeEqual", () => {
  it("compares correctly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true)
    expect(constantTimeEqual("abc", "abd")).toBe(false)
    expect(constantTimeEqual("abc", "abcd")).toBe(false)
    expect(constantTimeEqual("", "")).toBe(true)
  })
})

describe("env whitelist", () => {
  it("rejects keys outside the whitelist", () => {
    expect(validateEnvValue("PATH", "/x").ok).toBe(false)
    expect(validateEnvValue("NODE_OPTIONS", "--require x").ok).toBe(false)
    expect(validateEnvValue("SENSE_LLM_QWEN_API_KEY", "sk-1").ok).toBe(true)
    expect(ALLOWED_ENV_KEYS.has("SENSE_DEFAULT_LLM_PROVIDER")).toBe(true)
  })
  it("rejects newlines and control chars in values", () => {
    expect(validateEnvValue("SENSE_LLM_QWEN_API_KEY", "a\nEVIL=1").ok).toBe(false)
    expect(validateEnvValue("SENSE_LLM_QWEN_MODEL", "a\u0000b").ok).toBe(false)
  })
  it("buildEnvUpdates only emits allowed keys", () => {
    const r = buildEnvUpdates(
      { providerKey: "qwen", apiKey: "sk-abc", model: "m", setAsDefault: true },
      {}
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      for (const k of Object.keys(r.value.updates)) {
        expect(ALLOWED_ENV_KEYS.has(k)).toBe(true)
      }
      expect(r.value.updates.SENSE_DEFAULT_LLM_PROVIDER).toBe("qwen")
    }
  })
  it("rejects unknown provider, injected newline, and http baseUrl", () => {
    expect(buildEnvUpdates({ providerKey: "__proto__" }, {}).ok).toBe(false)
    expect(buildEnvUpdates({ providerKey: "evil" }, {}).ok).toBe(false)
    expect(
      buildEnvUpdates({ providerKey: "qwen", apiKey: "k\nX=1" }, {}).ok
    ).toBe(false)
    expect(
      buildEnvUpdates({ providerKey: "qwen", baseUrl: "http://evil.com/v1" }, {}).ok
    ).toBe(false)
  })
  it("keeps the existing key when none supplied", () => {
    const r = buildEnvUpdates(
      { providerKey: "kimi" },
      { SENSE_LLM_KIMI_API_KEY: "sk-old" }
    )
    expect(r.ok && r.value.updates.SENSE_LLM_KIMI_API_KEY).toBe("sk-old")
  })
})

describe("baseUrl validation", () => {
  it("requires https except loopback http", () => {
    expect(validateBaseUrl("https://api.example.com/v1/").ok).toBe(true)
    expect(validateBaseUrl("http://api.example.com/v1").ok).toBe(false)
    expect(validateBaseUrl("http://localhost:11434/v1").ok).toBe(true)
    expect(validateBaseUrl("http://127.0.0.1:8080").ok).toBe(true)
    expect(validateBaseUrl("ftp://x.com").ok).toBe(false)
    expect(validateBaseUrl("not a url").ok).toBe(false)
    expect(validateBaseUrl("https://u:p@x.com").ok).toBe(false)
    expect(validateBaseUrl("https://x.com/v1?k=1").ok).toBe(false)
  })
  it("normalizes trailing slashes", () => {
    const r = validateBaseUrl("https://x.com/v1//")
    expect(r.ok && r.value).toBe("https://x.com/v1")
  })
  it("chat baseUrl must match the saved one", () => {
    const saved = "https://api.deepseek.com/v1"
    expect(resolveChatBaseUrl(undefined, saved)).toMatchObject({ ok: true })
    expect(resolveChatBaseUrl("https://api.deepseek.com/v1/", saved).ok).toBe(true)
    expect(resolveChatBaseUrl("https://evil.com/v1", saved).ok).toBe(false)
    expect(resolveChatBaseUrl("http://evil.com/v1", saved).ok).toBe(false)
  })
})

describe("prompt and child env", () => {
  it("limits prompt length", () => {
    expect(validatePrompt("").ok).toBe(false)
    expect(validatePrompt("x".repeat(40_000)).ok).toBe(false)
    expect(validatePrompt(" hi ")).toEqual({ ok: true, value: "hi" })
  })
  it("builds a whitelisted env without secrets", () => {
    const env = buildChildEnv(
      {
        HOME: "/h",
        LANG: "en",
        SENSE_LLM_QWEN_API_KEY: "secret",
        SUPABASE_SERVICE_ROLE_KEY: "s",
        CODEX_HOME: "/c",
      },
      CLI_SPECS["codex-cli"].extraEnv,
      "/bin"
    )
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", LANG: "en", CODEX_HOME: "/c" })
  })
  it("never puts the prompt marker in argv templates", () => {
    for (const spec of Object.values(CLI_SPECS)) {
      expect(spec.args.join(" ")).not.toMatch(/prompt/i)
    }
  })
})
