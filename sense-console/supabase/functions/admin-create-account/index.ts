import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { withSupabase } from "npm:@supabase/server@1.4.1"

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
}

type CreateAccountBody = {
  organizationId?: unknown
  email?: unknown
  password?: unknown
  displayName?: unknown
  role?: unknown
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (request.method !== "POST") return json({ message: "仅支持 POST 请求。" }, 405)

    const { data: authData, error: authError } = await context.supabase.auth.getUser()
    const actor = authData.user
    if (authError || !actor) return json({ message: "登录状态无效，请重新登录。" }, 401)

    let body: CreateAccountBody
    try {
      body = await request.json()
    } catch {
      return json({ message: "请求内容不是有效的 JSON。" }, 400)
    }

    const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : ""
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const password = typeof body.password === "string" ? body.password : ""
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : ""
    const role = typeof body.role === "string" ? body.role.trim().toLowerCase() : ""

    if (!organizationId || !email || !email.includes("@")) {
      return json({ message: "请填写有效的组织和邮箱。" }, 400)
    }
    if (password.length < 8) return json({ message: "临时密码至少需要 8 位。" }, 400)
    if (!displayName || displayName.length > 80) {
      return json({ message: "显示名称需要为 1 至 80 个字符。" }, 400)
    }
    if (!role || !/^[a-z][a-z0-9_]*$/.test(role)) {
      return json({ message: "角色格式无效。" }, 400)
    }

    const { data: actorMembership, error: membershipError } = await context.supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", actor.id)
      .single()

    if (membershipError || !actorMembership) {
      return json({ message: "当前账号不属于目标组织。" }, 403)
    }

    const [{ data: actorRole, error: actorRoleError }, { data: targetRole, error: targetRoleError }] = await Promise.all([
      context.supabase
        .from("organization_roles")
        .select("permissions")
        .eq("organization_id", organizationId)
        .eq("role_key", actorMembership.role)
        .single(),
      context.supabase
        .from("organization_roles")
        .select("role_key, assignment_permission, is_assignable")
        .eq("organization_id", organizationId)
        .eq("role_key", role)
        .single(),
    ])

    if (actorRoleError || !actorRole || !actorRole.permissions.includes("account.manage")) {
      return json({ message: "当前角色没有账号管理权限。" }, 403)
    }
    if (targetRoleError || !targetRole || !targetRole.is_assignable) {
      return json({ message: "目标角色不存在或不可分配。" }, 400)
    }
    if (!actorRole.permissions.includes(targetRole.assignment_permission)) {
      return json({ message: "当前角色不能分配该目标角色。" }, 403)
    }

    const { data: created, error: createError } = await context.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
      app_metadata: { organization_id: organizationId, organization_role: role },
    })

    const createdUser = created.user
    if (createError || !createdUser) {
      const duplicate = createError?.message.toLowerCase().includes("already")
      return json({ message: duplicate ? "该邮箱已经存在。" : "账号创建失败，请稍后重试。" }, duplicate ? 409 : 400)
    }

    const cleanupUser = async () => {
      const { error } = await context.supabaseAdmin.auth.admin.deleteUser(createdUser.id)
      if (error) console.error("[admin-create-account] rollback failed", error)
    }

    const { error: profileError } = await context.supabaseAdmin.from("profiles").insert({
      user_id: createdUser.id,
      email,
      display_name: displayName,
      status: "active",
    })
    if (profileError) {
      await cleanupUser()
      return json({ message: "账号资料创建失败，操作已回滚。" }, 500)
    }

    const { error: memberError } = await context.supabaseAdmin.from("organization_members").insert({
      organization_id: organizationId,
      user_id: createdUser.id,
      role,
      created_by: actor.id,
    })
    if (memberError) {
      await cleanupUser()
      return json({ message: "组织成员关系创建失败，操作已回滚。" }, 500)
    }

    const { error: auditError } = await context.supabaseAdmin.from("audit_events").insert({
      organization_id: organizationId,
      actor_user_id: actor.id,
      action: "account.created",
      target_type: "auth_user",
      target_id: createdUser.id,
      metadata: { email, display_name: displayName, role },
    })
    if (auditError) {
      await cleanupUser()
      return json({ message: "审计记录创建失败，操作已回滚。" }, 500)
    }

    return json({
      account: {
        id: createdUser.id,
        email,
        displayName,
        role,
        status: "active",
      },
    }, 201)
  }),
}
