import { useState, type ReactElement } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

/**
 * Self-contained delete confirmation: owns its own open state and mutation
 * (mirrors how `AssetDialog` owns its create/update mutation), so a page
 * only has to render one of these per row with a `mutationFn` and the query
 * keys to invalidate afterwards.
 */
export function ConfirmDeleteDialog({
  trigger,
  title,
  description,
  mutationFn,
  invalidateKeys,
  successMessage,
}: {
  trigger: ReactElement
  title: string
  description: string
  mutationFn: () => Promise<unknown>
  invalidateKeys: readonly (readonly unknown[])[]
  successMessage: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const mutation = useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(invalidateKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })))
      setOpen(false)
      toast.success(successMessage)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "删除失败。"),
  })

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!mutation.isPending) setOpen(next) }}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia><TriangleAlertIcon /></AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "删除中…" : "确认删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
