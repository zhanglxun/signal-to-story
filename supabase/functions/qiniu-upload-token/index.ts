import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { withSupabase } from "npm:@supabase/server@1.4.1"

const corsHeaders = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Origin": "*" }
const imageExtensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }
function json(body: Record<string, unknown>, status = 200) { return Response.json(body, { status, headers: corsHeaders }) }
function base64Url(bytes: Uint8Array | string) { const source = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes; let binary = ""; source.forEach((byte) => { binary += String.fromCharCode(byte) }); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_") }
async function hmacSha1(secret: string, value: string) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))) }

export default { fetch: withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (request.method !== "POST") return json({ message: "仅支持 POST 请求。" }, 405)
  const { data: authData } = await context.supabase.auth.getUser(); const actor = authData.user
  if (!actor) return json({ message: "登录状态无效，请重新登录。" }, 401)
  const body = await request.json().catch(() => null) as { organizationId?: unknown; contentType?: unknown } | null
  const organizationId = typeof body?.organizationId === "string" ? body.organizationId : ""
  const contentType = typeof body?.contentType === "string" ? body.contentType : ""
  const extension = imageExtensions[contentType]
  if (!organizationId || !extension) return json({ message: "组织或图片类型无效。" }, 400)
  const { data: membership } = await context.supabase.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", actor.id).maybeSingle()
  if (!membership) return json({ message: "当前账号不属于目标组织。" }, 403)
  const { data: role } = await context.supabase.from("organization_roles").select("permissions").eq("organization_id", organizationId).eq("role_key", membership.role).maybeSingle()
  if (!role?.permissions.includes("content.manage")) return json({ message: "当前账号没有素材上传权限。" }, 403)
  const accessKey = Deno.env.get("QINIU_ACCESS_KEY"), secretKey = Deno.env.get("QINIU_SECRET_KEY"), bucket = Deno.env.get("QINIU_BUCKET"), prefix = (Deno.env.get("QINIU_PREFIX") ?? "signal-story").replace(/^\/+|\/+$/g, ""), uploadHost = Deno.env.get("QINIU_UPLOAD_HOST") ?? "up-z2.qiniup.com", publicDomain = Deno.env.get("QINIU_PUBLIC_DOMAIN")?.replace(/\/+$/, "")
  if (!accessKey || !secretKey || !bucket) return json({ message: "七牛服务端密钥尚未配置。" }, 503)
  const key = `${prefix}/prompts/${crypto.randomUUID()}.${extension}`
  const encodedPolicy = base64Url(JSON.stringify({ scope: `${bucket}:${key}`, deadline: Math.floor(Date.now() / 1000) + 300, insertOnly: 1, returnBody: '{"key":"$(key)","hash":"$(etag)","size":$(fsize)}' }))
  const signature = base64Url(await hmacSha1(secretKey, encodedPolicy))
  return json({ provider: "qiniu_kodo", bucket, key, publicUrl: publicDomain ? `${publicDomain}/${key}` : null, uploadUrl: `https://${uploadHost}`, uploadToken: `${accessKey}:${signature}:${encodedPolicy}`, expiresIn: 300 })
}) }
