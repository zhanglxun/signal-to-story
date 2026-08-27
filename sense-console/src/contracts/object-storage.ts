export const managedImageMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const
export type ManagedImagePurpose = "prompt_example"
export type StoredObject = { path: string; publicUrl: string | null }
