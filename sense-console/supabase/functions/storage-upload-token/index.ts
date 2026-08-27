import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { withSupabase } from "npm:@supabase/server@1.4.1"

const corsHeaders = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Origin": "*" }
const imageExtensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }
const purposeFolders = { prompt_example: "prompts" } as const
function json(body: Record<string, unknown>, status = 200) { return Response.json(body, { status, headers: corsHeaders }) }
function base64Url(value: Uint8Array | string) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value; let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_") }
async function sign(secret: string, value: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))) }

export default { fetch: withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders }); if (request.method !== "POST") return json({ message: "仅支持 POST 请求。" }, 405)
  const { data: auth } = await context.supabase.auth.getUser(); if (!auth.user) return json({ message: "登录状态无效，请重新登录。" }, 401)
  const body = await request.json().catch(() => null) as { organizationId?: unknown; contentType?: unknown; purpose?: unknown } | null
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : "", contentType = typeof body?.contentType === "string" ? body.contentType : "", purpose = typeof body?.purpose === "string" && body.purpose in purposeFolders ? body.purpose as keyof typeof purposeFolders : null, extension = imageExtensions[contentType]
  if (!organizationId || !purpose || !extension) return json({ message: "上传请求参数无效。" }, 400)
  const { data: membership } = await context.supabase.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", auth.user.id).maybeSingle()
  const { data: role } = membership ? await context.supabase.from("organization_roles").select("permissions").eq("organization_id", organizationId).eq("role_key", membership.role).maybeSingle() : { data: null }
  if (!role?.permissions.includes("content.manage")) return json({ message: "当前账号没有素材上传权限。" }, 403)
  const accessKey = Deno.env.get("QINIU_ACCESS_KEY"), secretKey = Deno.env.get("QINIU_SECRET_KEY"), bucket = Deno.env.get("QINIU_BUCKET"), prefix = (Deno.env.get("QINIU_PREFIX") ?? "signal-story").replace(/^\/+|\/+$/g, ""), host = Deno.env.get("QINIU_UPLOAD_HOST") ?? "up-z2.qiniup.com", domain = Deno.env.get("QINIU_PUBLIC_DOMAIN")?.replace(/\/+$/, "")
  if (!accessKey || !secretKey || !bucket) return json({ message: "对象存储服务端密钥尚未配置。" }, 503)
  const objectKey = `${prefix}/${purposeFolders[purpose]}/${crypto.randomUUID()}.${extension}`, policy = base64Url(JSON.stringify({ scope: `${bucket}:${objectKey}`, deadline: Math.floor(Date.now() / 1000) + 300, insertOnly: 1, returnBody: '{"key":"$(key)","hash":"$(etag)","size":$(fsize)}' })), token = `${accessKey}:${base64Url(await sign(secretKey, policy))}:${policy}`
  return json({ provider: "qiniu_kodo", bucket, key: objectKey, publicUrl: domain ? `${domain}/${objectKey}` : null, uploadUrl: `https://${host}`, uploadToken: token, expiresIn: 300 })
}) }
