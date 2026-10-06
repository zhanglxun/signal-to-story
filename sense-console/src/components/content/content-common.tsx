import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'

export function ContentState({ loading, error, hasOrg }: { loading: boolean; error: Error | null; hasOrg: boolean }) {
  if (loading) return <p role="status">正在读取云端内容…</p>
  if (error) return <Alert variant="destructive"><AlertTitle>暂时无法读取内容</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
  if (!hasOrg) return <Alert><AlertTitle>请先加入组织</AlertTitle><AlertDescription>在系统管理中完成组织与账号初始化。</AlertDescription></Alert>
  return null
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}</div>
}
