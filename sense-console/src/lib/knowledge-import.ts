/** Fallback slug for an imported file: the file name, lower-cased; random-ish when nothing usable remains. */
export function fallbackSlugFromFilename(filename: string | null | undefined): string {
  const base = (filename ?? "").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100)
  return base || `imported-${Date.now().toString(36)}`
}

/** File.text() is missing in some environments (older jsdom); fall back to FileReader. */
export function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"))
    reader.readAsText(file)
  })
}
