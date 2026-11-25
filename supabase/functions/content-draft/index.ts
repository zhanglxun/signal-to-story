import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
  const authorization = req.headers.get('Authorization') ?? ''
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: identity, error: authError } = await client.auth.getUser()
  if (authError || !identity.user) return reply({ error: '需要登录' }, 401)
  let input: { document_id?: string; instruction?: string; mode?: string; idempotency_key?: string }
  try { input = await req.json() } catch { return reply({ error: '请求格式无效' }, 400) }
  if (input.mode === 'sync') return reply({ error: '同步模式已下线，请使用队列出稿模式' }, 410)
  if (!input.document_id || typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 4000) {
    return reply({ error: '请填写 1–4000 字创作要求' }, 400)
  }
  const { data: doc, error: docError } = await client.from('content_documents').select('*').eq('id', input.document_id).single()
  if (docError || !doc) return reply({ error: '稿件不存在或无权访问' }, 404)
  const { data: member } = await client.from('organization_members').select('role').eq('organization_id', doc.organization_id).eq('user_id', identity.user.id).single()
  const { data: role } = await client.from('organization_roles').select('permissions').eq('organization_id', doc.organization_id).eq('role_key', member?.role ?? '').single()
  if (!role?.permissions?.includes('content.manage')) return reply({ error: '没有创作权限' }, 403)

  if (input.idempotency_key !== undefined && (typeof input.idempotency_key !== 'string' || !/^[\w:.-]{1,200}$/.test(input.idempotency_key))) {
    return reply({ error: '幂等键格式无效' }, 400)
  }
  const trimmed = input.instruction.trim()
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(trimmed))), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  const idempotencyKey = input.idempotency_key ?? `content_draft:${doc.id}:r${doc.revision}:${digest}`
  const { data: existing } = await client.from('agent_jobs').select('id,status').eq('organization_id', doc.organization_id).eq('idempotency_key', idempotencyKey).maybeSingle()
  const { data: job, error: enqueueError } = await client.rpc('enqueue_agent_job', {
    p_organization_id: doc.organization_id,
    p_job_type: 'content_draft',
    p_idempotency_key: idempotencyKey,
    p_payload: { document_id: doc.id, instruction: trimmed, platform: doc.platform },
    p_target_type: 'content_document',
    p_target_id: doc.id,
    p_target_revision: doc.revision,
    p_work_item_id: doc.work_item_id ?? null,
  })
  if (enqueueError || !job) {
    return reply({ error: enqueueError?.code === '42501' ? '没有调度 Agent 任务的权限' : '排队失败，稿件可能已被修改，请刷新后重试' }, enqueueError?.code === '42501' ? 403 : 409)
  }
  return reply({ job_id: job.id, status: job.status, duplicate: Boolean(existing) }, existing ? 200 : 202)
})
