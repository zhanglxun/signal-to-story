import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function useContentAction() {
  const [busy, setBusy] = useState(false)
  const client = useQueryClient()
  async function run(action: () => Promise<unknown>, message = '已保存到云端') {
    if (busy) return false
    setBusy(true)
    try {
      await action()
      await Promise.all([
        client.invalidateQueries({ queryKey: ['cloud-content'] }),
        client.invalidateQueries({ queryKey: ['content-project'] }),
        client.invalidateQueries({ queryKey: ['document-history'] }),
      ])
      toast.success(message)
      return true
    } catch (error) { toast.error(error instanceof Error ? error.message : '操作失败，请重试'); return false }
    finally { setBusy(false) }
  }
  return { busy, run }
}
export function downloadText(filename: string, content: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function localDateValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
