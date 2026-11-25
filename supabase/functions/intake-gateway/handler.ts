import { normalizeIntake, type IntakeInput } from "./contract.ts"
export type AcceptResult = {
  data: unknown
  error: { code?: string; message: string } | null
}
export type Accept = (hash: string, input: IntakeInput) => Promise<AcceptResult>
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers })
export function createHandler(accept: Accept) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST")
      return reply({ error: "method_not_allowed" }, 405)
    const token = req.headers
      .get("Authorization")
      ?.match(/^Bearer (stk_[a-f0-9]{64})$/)?.[1]
    if (!token) return reply({ error: "unauthorized" }, 401)
    if (
      !req.headers
        .get("Content-Type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      return reply({ error: "json_required" }, 415)
    let input: IntakeInput
    try {
      // Enforce bytes even when Content-Length is omitted or falsified.
      const reader = req.body?.getReader()
      if (!reader) return reply({ error: "empty_body" }, 400)
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 24000) {
          await reader.cancel()
          return reply({ error: "body_too_large" }, 413)
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      input = normalizeIntake(JSON.parse(new TextDecoder().decode(bytes)))
    } catch (e) {
      return reply(
        {
          error: "invalid_input",
          message: e instanceof Error ? e.message : "无效请求",
        },
        400
      )
    }
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
      ),
      (x) => x.toString(16).padStart(2, "0")
    ).join("")
    try {
      const { data, error } = await accept(hash, input)
      if (error) {
        const known: Record<string, number> = {
          invalid_connection: 401,
          idempotency_conflict: 409,
          rate_limited: 429,
          invalid_input: 400,
        }
        return reply(
          {
            error: known[error.message]
              ? error.message
              : "temporarily_unavailable",
          },
          known[error.message] ?? 503
        )
      }
      return reply(data)
    } catch {
      return reply({ error: "temporarily_unavailable" }, 503)
    }
  }
}
