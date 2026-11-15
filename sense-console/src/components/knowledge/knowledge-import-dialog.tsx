import { useState, type FormEvent, type ReactElement } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { fallbackSlugFromFilename, readFileText } from "@/lib/knowledge-import"
import { importKnowledgeMarkdown } from "@/services/knowledge-base-service"

/** Import Markdown (file or pasted). The entry always lands as `unreviewed`. */
export function KnowledgeImportDialog({ organizationId, trigger }: { organizationId: string; trigger: ReactElement }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [markdown, setMarkdown] = useState("")
  const [filename, setFilename] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => importKnowledgeMarkdown(organizationId, markdown, fallbackSlugFromFilename(filename)),
    onSuccess: async (entry) => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge-entries"] })
      setMarkdown("")
      setFilename(null)
      setOpen(false)
      toast.success(`已导入「${entry.title}」（未审核）`)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "导入失败"),
  })

  async function onFile(file: File | undefined) {
    if (!file) return
    try {
      setMarkdown(await readFileText(file))
      setFilename(file.name)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取文件失败")
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) setOpen(next) }}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>导入 Markdown</DialogTitle>
            <DialogDescription>支持 frontmatter（slug、title、category、tags、source_url）；没有 frontmatter 时以首个 # 标题作为标题。</DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertTitle>导入后为「未审核」</AlertTitle>
            <AlertDescription>未审核内容只作为不可信参考资料，不会进入系统指令区。需有审核权限的成员标记为「可信」后才会成为 Agent 的规则。</AlertDescription>
          </Alert>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="kb-file">选择 .md 文件</Label>
              <Input id="kb-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="kb-markdown">或粘贴 Markdown</Label>
              <Textarea id="kb-markdown" className="min-h-48 font-mono" maxLength={200000} value={markdown} onChange={(e) => { setMarkdown(e.target.value); setFilename(null) }} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" disabled={mutation.isPending || !markdown.trim()}>{mutation.isPending ? "导入中…" : "导入为未审核"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
