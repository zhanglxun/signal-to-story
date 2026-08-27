import type { ManagedImagePurpose, StoredObject } from "@/contracts/object-storage"
import { getSupabaseClient } from "@/lib/supabase"
import { getStorageProviderConfigs } from "@/services/storage-provider-service"

const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }
const maxImageBytes = 10 * 1024 * 1024
function client() { const value = getSupabaseClient(); if (!value) throw new Error("Supabase 尚未配置。"); return value }
function validateImage(file: File) { if (!extensions[file.type]) throw new Error("仅支持 JPG、PNG、WebP 或 GIF 图片。"); if (file.size > maxImageBytes) throw new Error("图片不能超过 10MB。") }

/** Uploads through the organization-selected provider without exposing secrets. */
export async function uploadManagedImage(input: { organizationId: string; purpose: ManagedImagePurpose; file: File }): Promise<StoredObject> {
  validateImage(input.file)
  const supabase = client(), active = (await getStorageProviderConfigs(input.organizationId)).find((config) => config.isDefault)
  if (!active) throw new Error("尚未设置默认对象存储。")
  if (active.provider === "qiniu_kodo") {
    const { data, error } = await supabase.functions.invoke("storage-upload-token", { body: { organizationId: input.organizationId, purpose: input.purpose, contentType: input.file.type } })
    if (error || !data) throw new Error("无法取得对象存储上传凭证。")
    const form = new FormData(); form.set("token", data.uploadToken); form.set("key", data.key); form.set("file", input.file)
    const response = await fetch(data.uploadUrl, { method: "POST", body: form })
    if (!response.ok) throw new Error("对象存储图片上传失败，请稍后重试。")
    return { path: `qiniu://${data.bucket}/${data.key}`, publicUrl: typeof data.publicUrl === "string" ? data.publicUrl : null }
  }
  if (active.provider !== "supabase") throw new Error(`${active.provider} 尚未实现上传适配器。`)
  const path = `${input.organizationId}/${crypto.randomUUID()}.${extensions[input.file.type]}`
  const { error } = await supabase.storage.from(active.bucket).upload(path, input.file, { contentType: input.file.type, upsert: false })
  if (error) throw new Error("图片上传失败，请检查当前账号权限或稍后重试。")
  return { path, publicUrl: null }
}

export async function deleteManagedObject(path: string, bucket = "prompt-examples") { if (path.startsWith("qiniu://")) return; const { error } = await client().storage.from(bucket).remove([path]); if (error) throw new Error("旧图片清理失败。") }
