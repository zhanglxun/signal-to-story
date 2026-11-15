/**
 * Vite dev-server 本地桥插件（仅 `vite serve`，apply: "serve"，生产构建不包含）。
 * 校验逻辑见 ./local-bridge-guard.ts。
 */
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Plugin } from "vite"
import {
  BRIDGE_PREFIX,
  CLI_SPECS,
  MAX_BODY_BYTES,
  PROVIDER_DEFAULTS,
  bridgePathname,
  buildChildEnv,
  buildEnvUpdates,
  hasControlChars,
  resolveChatBaseUrl,
  validateBridgeRequest,
  validatePrompt,
} from "./local-bridge-guard"

const CLI_TIMEOUT_MS = 45_000
const MAX_CLI_OUTPUT = 1024 * 1024
const MAX_CONCURRENT_CLI = 2

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  const result: Record<string, string> = {}
  for (const rawLine of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eqIdx = line.indexOf("=")
    if (eqIdx <= 0) continue
    const key = line.slice(0, eqIdx).trim()
    let val = line.slice(eqIdx + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    result[key] = val
  }
  return result
}

function writeEnvUpdates(filePath: string, updates: Record<string, string>) {
  const existingLines = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8").split(/\r?\n/)
    : []
  const updatedKeys = new Set<string>()
  const nextLines = existingLines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) return line
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx <= 0) return line
    const key = trimmed.slice(0, eqIdx).trim()
    if (key in updates) {
      updatedKeys.add(key)
      return `${key}=${JSON.stringify(updates[key])}`
    }
    return line
  })
  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) nextLines.push(`${key}=${JSON.stringify(val)}`)
  }
  const finalContent =
    nextLines.filter((l, i, arr) => i < arr.length - 1 || l !== "").join("\n") +
    "\n"
  fs.writeFileSync(filePath, finalContent, { encoding: "utf-8", mode: 0o600 })
}

function maskSecret(secret: string | undefined): string | null {
  if (!secret || !secret.trim()) return null
  const clean = secret.trim()
  if (clean.length <= 8) return "••••" + clean.slice(-2)
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`
}

function enhancedPath(): string {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(process.env.HOME ?? "", ".local/bin"),
    path.join(process.env.HOME ?? "", ".npm-global/bin"),
    process.env.PATH ?? "",
  ].join(":")
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function runProcess(
  command: string,
  args: readonly string[],
  opts: { env: Record<string, string>; input?: string; timeoutMs: number }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: opts.env,
      cwd: os.tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, opts.timeoutMs)
    child.stdout.on("data", (c) => {
      if (stdout.length < MAX_CLI_OUTPUT) stdout += String(c)
    })
    child.stderr.on("data", (c) => {
      if (stderr.length < MAX_CLI_OUTPUT) stderr += String(c)
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.stdin.on("error", () => {})
    child.stdin.end(opts.input ?? "")
  })
}

async function detectCliBinary(binary: string, extraEnv: readonly string[]) {
  const env = buildChildEnv(process.env, extraEnv, enhancedPath())
  try {
    const which = await runProcess("which", [binary], { env, timeoutMs: 4000 })
    const binaryPath = which.stdout.trim().split(/\r?\n/)[0]
    if (which.code !== 0 || !binaryPath) {
      return { installed: false, binaryPath: null, version: null, env }
    }
    try {
      const ver = await runProcess(binaryPath, ["--version"], {
        env,
        timeoutMs: 4000,
      })
      const line = (ver.stdout || ver.stderr).trim().split(/\r?\n/)[0]?.slice(0, 64)
      return { installed: true, binaryPath, version: line || "已安装", env }
    } catch {
      return { installed: true, binaryPath, version: "已安装", env }
    }
  } catch {
    return { installed: false, binaryPath: null, version: null, env }
  }
}

class BodyTooLargeError extends Error {}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        reject(new BodyTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      if (tooLarge) return
      try {
        const text = Buffer.concat(chunks).toString("utf-8")
        const parsed: unknown = text ? JSON.parse(text) : {}
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("请求体必须是 JSON 对象"))
          return
        }
        resolve(parsed as Record<string, unknown>)
      } catch (err) {
        reject(err)
      }
    })
    req.on("error", reject)
  })
}

export function senseLocalBridgePlugin(): Plugin {
  const envLocalPath = path.resolve(__dirname, "..", ".env.local")
  // 每次 dev server 启动重新生成；仅通过 transformIndexHtml 注入同源页面
  const token = randomBytes(32).toString("hex")
  let activeCli = 0

  return {
    name: "sense-local-bridge",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { name: "sense-bridge-token", content: token },
          injectTo: "head",
        },
      ]
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ""
        if (!url.startsWith(BRIDGE_PREFIX)) return next()

        const sendJson = (status: number, data: unknown) => {
          res.statusCode = status
          res.setHeader("Content-Type", "application/json; charset=utf-8")
          res.setHeader("Cache-Control", "no-store")
          res.end(JSON.stringify(data))
        }

        const verdict = validateBridgeRequest({
          method: req.method ?? "GET",
          url,
          remoteAddress: req.socket.remoteAddress,
          headers: req.headers,
          token,
        })
        if (!verdict.ok) {
          return sendJson(verdict.status, { ok: false, error: verdict.error })
        }

        const pathname = bridgePathname(url)
        const method = req.method?.toUpperCase()

        try {
          if (method === "GET" && pathname === "/__sense_bridge/status") {
            const envMap = parseEnvFile(envLocalPath)
            const defaultProvider = envMap.SENSE_DEFAULT_LLM_PROVIDER || "qwen"
            const providers = Object.entries(PROVIDER_DEFAULTS).map(
              ([key, def]) => {
                const rawKey =
                  envMap[`${def.envPrefix}_API_KEY`] ||
                  (key === defaultProvider ? envMap.CONTENT_AI_API_KEY : "")
                return {
                  key,
                  configured: Boolean(rawKey && rawKey.trim()),
                  maskedKey: maskSecret(rawKey),
                  baseUrl: envMap[`${def.envPrefix}_BASE_URL`] || def.baseUrl,
                  model: envMap[`${def.envPrefix}_MODEL`] || def.model,
                  isDefault: key === defaultProvider,
                }
              }
            )
            const cliDrivers = await Promise.all(
              Object.entries(CLI_SPECS).map(async ([key, spec]) => {
                const { installed, binaryPath, version } =
                  await detectCliBinary(spec.binary, spec.extraEnv)
                return {
                  key,
                  binary: spec.binary,
                  installed,
                  binaryPath,
                  version,
                  argsVerified: spec.argsVerified,
                }
              })
            )
            return sendJson(200, {
              ok: true,
              envFilePath: ".env.local",
              defaultProvider,
              providers,
              cliDrivers,
            })
          }

          if (method === "POST" && pathname === "/__sense_bridge/env") {
            const body = await readJsonBody(req)
            const built = buildEnvUpdates(body, parseEnvFile(envLocalPath))
            if (!built.ok) return sendJson(400, { ok: false, error: built.error })
            writeEnvUpdates(envLocalPath, built.value.updates)
            return sendJson(200, {
              ok: true,
              providerKey: String(body.providerKey),
              maskedKey: maskSecret(built.value.apiKey),
              savedTo: ".env.local",
            })
          }

          if (method === "POST" && pathname === "/__sense_bridge/chat") {
            const body = await readJsonBody(req)
            const driverMode = String(body.driverMode ?? "cloud_api")
            const promptCheck = validatePrompt(body.prompt)
            if (!promptCheck.ok) {
              return sendJson(400, { ok: false, error: promptCheck.error })
            }
            const prompt = promptCheck.value
            const startedAt = Date.now()

            if (driverMode === "local_cli") {
              const cliKey = String(body.cliKey ?? "codex-cli")
              const spec = Object.hasOwn(CLI_SPECS, cliKey)
                ? CLI_SPECS[cliKey]
                : undefined
              if (!spec) {
                return sendJson(400, { ok: false, error: "未知的 CLI 驱动类型" })
              }
              const detection = await detectCliBinary(spec.binary, spec.extraEnv)
              if (!detection.installed || !detection.binaryPath) {
                return sendJson(404, {
                  ok: false,
                  error: `本机未检测到 ${spec.binary} 命令，请先按页面引导完成安装。`,
                })
              }
              if (activeCli >= MAX_CONCURRENT_CLI) {
                return sendJson(429, { ok: false, error: "本地 CLI 任务过多，请稍后重试" })
              }
              activeCli++
              try {
                const r = await runProcess(detection.binaryPath, spec.args, {
                  env: detection.env,
                  input: prompt,
                  timeoutMs: CLI_TIMEOUT_MS,
                })
                if (r.timedOut) {
                  return sendJson(504, {
                    ok: false,
                    error: `本地 ${spec.binary} 执行超时（${CLI_TIMEOUT_MS / 1000}s）`,
                  })
                }
                if (r.code !== 0) {
                  return sendJson(502, {
                    ok: false,
                    error: `调用本地 ${spec.binary} 失败（退出码 ${r.code}）：${(r.stderr || r.stdout).trim().slice(0, 240)}${spec.argsVerified ? "" : `；${spec.note}`}`,
                  })
                }
                const replyText = (r.stdout || r.stderr || "").trim()
                return sendJson(200, {
                  ok: true,
                  driverMode: "local_cli",
                  engine: `${spec.binary} (${detection.version ?? "local"})`,
                  reply:
                    replyText ||
                    `[${spec.binary} 执行完成，退出码 0，无标准文本输出]`,
                  durationMs: Date.now() - startedAt,
                  argsVerified: spec.argsVerified,
                  ...(spec.argsVerified ? {} : { warning: spec.note }),
                })
              } catch (cliErr) {
                const msg = cliErr instanceof Error ? cliErr.message : "CLI 调用异常"
                return sendJson(502, {
                  ok: false,
                  error: `调用本地 ${spec.binary} 失败: ${msg.slice(0, 240)}`,
                })
              } finally {
                activeCli--
              }
            }

            // cloud_api
            const systemPrompt =
              typeof body.systemPrompt === "string" && body.systemPrompt.trim()
                ? body.systemPrompt.trim().slice(0, 8000)
                : "你是星火工厂（Signal to Story）智能内容助手，请用简洁、准确的中文回答。"
            const envMap = parseEnvFile(envLocalPath)
            const requestedProvider = String(
              body.providerKey || envMap.SENSE_DEFAULT_LLM_PROVIDER || "qwen"
            )
            const providerKey = Object.hasOwn(PROVIDER_DEFAULTS, requestedProvider)
              ? requestedProvider
              : "qwen"
            const def = PROVIDER_DEFAULTS[providerKey]
            const apiKey =
              envMap[`${def.envPrefix}_API_KEY`] || envMap.CONTENT_AI_API_KEY
            if (!apiKey || !apiKey.trim()) {
              return sendJson(400, {
                ok: false,
                error: `[${providerKey}] 尚未配置 API Key。请前往「系统管理 → 大模型接入」填写 Key 并保存到 .env.local。`,
              })
            }
            const baseCheck = resolveChatBaseUrl(
              body.baseUrl,
              envMap[`${def.envPrefix}_BASE_URL`] || def.baseUrl
            )
            if (!baseCheck.ok) {
              return sendJson(400, { ok: false, error: baseCheck.error })
            }
            const baseUrl = baseCheck.value
            const model =
              (typeof body.model === "string" && body.model.trim()) ||
              envMap[`${def.envPrefix}_MODEL`] ||
              def.model
            if (model.length > 128 || hasControlChars(model)) {
              return sendJson(400, { ok: false, error: "model 无效" })
            }

            const upstream = await fetch(`${baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey.trim()}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                max_tokens: 2048,
                stream: false,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: prompt },
                ],
              }),
              signal: AbortSignal.timeout(60000),
            })
            const rawJson = (await upstream.json().catch(() => null)) as Record<
              string,
              unknown
            > | null
            if (!upstream.ok) {
              const upstreamErr =
                (rawJson?.error as { message?: string })?.message ||
                (rawJson?.error as { code?: string })?.code ||
                `HTTP ${upstream.status}`
              return sendJson(502, {
                ok: false,
                error: `调用 ${providerKey} (${model}) 失败：${upstreamErr}`,
              })
            }
            const choices = rawJson?.choices as
              | Array<{ message?: { content?: string } }>
              | undefined
            return sendJson(200, {
              ok: true,
              driverMode: "cloud_api",
              engine: `${providerKey} / ${model}`,
              reply: choices?.[0]?.message?.content || "(模型返回空内容)",
              usage: rawJson?.usage ?? null,
              durationMs: Date.now() - startedAt,
            })
          }

          return sendJson(404, { ok: false, error: "Not found" })
        } catch (error) {
          if (error instanceof BodyTooLargeError) {
            return sendJson(413, { ok: false, error: "请求体过大" })
          }
          return sendJson(500, {
            ok: false,
            error: error instanceof Error ? error.message : "Bridge internal error",
          })
        }
      })
    },
  }
}
