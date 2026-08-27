export type StorageProviderKey = "supabase" | "aliyun_oss" | "tencent_cos" | "qiniu_kodo" | "cloudflare_r2"

export type StorageProviderDefinition = { key: StorageProviderKey; name: string; shortName: string; protocol: string; requiredConfiguration: string[]; notes: string }

/** This registry never contains credentials; provider secrets stay server-side. */
export const storageProviderDefinitions: StorageProviderDefinition[] = [
  { key: "supabase", name: "Supabase Storage", shortName: "Supabase", protocol: "Supabase Storage API + RLS", requiredConfiguration: ["Bucket 名称", "最大文件大小", "允许的 MIME 类型", "Storage RLS 策略"], notes: "当前图例上传默认写入私有 prompt-examples bucket。" },
  { key: "aliyun_oss", name: "阿里云 OSS", shortName: "阿里云 OSS", protocol: "S3 兼容 API / 签名上传", requiredConfiguration: ["地域与 Endpoint", "Bucket", "Access Key（仅服务端）", "自定义域名 / CORS"], notes: "适合国内内容与 CDN；中国内地 Bucket 应预先配置自定义域名。" },
  { key: "tencent_cos", name: "腾讯云 COS", shortName: "腾讯云 COS", protocol: "S3 兼容 API / 签名上传", requiredConfiguration: ["地域", "Bucket 名称与 AppID", "临时密钥服务端签发", "CORS / CDN 域名"], notes: "适合国内访问；可使用临时密钥或预签名 URL，不暴露永久密钥。" },
  { key: "qiniu_kodo", name: "七牛云 Kodo", shortName: "七牛 Kodo", protocol: "七牛上传凭证 / S3 兼容 API", requiredConfiguration: ["存储空间", "地域", "服务端上传凭证", "加速域名 / CORS"], notes: "图片处理和内容分发能力较成熟，适合作为素材图床。" },
  { key: "cloudflare_r2", name: "Cloudflare R2", shortName: "Cloudflare R2", protocol: "S3 兼容 API / 签名上传", requiredConfiguration: ["Account ID", "Bucket", "R2 API Token（仅服务端）", "自定义域名"], notes: "无外网出站流量费；但中国大陆访问体验应先用真实素材验证。" },
]
