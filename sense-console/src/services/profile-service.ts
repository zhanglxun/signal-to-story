import { getSupabaseClient } from "@/lib/supabase"

export async function updateCurrentProfileDisplayName(displayName: string) {
  const normalizedDisplayName = displayName.trim()
  if (!normalizedDisplayName) throw new Error("显示名称不能为空。")

  const supabase = getSupabaseClient()
  if (!supabase) throw new Error("Supabase 尚未配置。")

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error("登录会话已失效，请重新登录。")

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: normalizedDisplayName })
    .eq("user_id", userData.user.id)
    .select("display_name")
    .single()

  if (error) throw new Error("个人资料保存失败，请稍后再试。")
  return data.display_name as string
}
