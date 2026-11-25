import { useQuery } from "@tanstack/react-query"
import { ChevronRightIcon, FolderTreeIcon, PencilIcon, PlusIcon, TagsIcon, Trash2Icon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { SourceCategoryDialog } from "@/components/source-categories/source-category-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { buildSourceCategoryTree, type SourceCategory, type SourceCategoryNode } from "@/contracts/source-category"
import { getContentWorkspace } from "@/services/content-workspace-service"
import { deleteSourceCategory, getSourceCategories } from "@/services/source-category-service"

const workspaceKey = ["content-workspace"] as const

function CategoryIcon({ category, className = "size-4" }: { category: SourceCategory; className?: string }) {
  if (category.iconUrl) return <img src={category.iconUrl} alt="" className={`${className} rounded object-cover`} />
  return <TagsIcon className={`${className} text-muted-foreground`} />
}

function CategoryRow({
  category,
  organizationId,
  canManage,
  topLevelCategories,
  allowAddChild = false,
  indent = false,
}: {
  category: SourceCategory
  organizationId: string
  canManage: boolean
  topLevelCategories: SourceCategory[]
  allowAddChild?: boolean
  indent?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2 ${indent ? "pl-9" : ""}`}>
      <div className="flex min-w-0 items-center gap-2">
        <CategoryIcon category={category} />
        <span className="truncate font-medium">{category.name}</span>
        <Badge variant={category.isActive ? "outline" : "secondary"}>{category.isActive ? "启用" : "禁用"}</Badge>
        <span className="text-xs text-muted-foreground">排序 {category.sortOrder}</span>
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          {allowAddChild && (
            <SourceCategoryDialog
              organizationId={organizationId}
              topLevelCategories={topLevelCategories}
              defaultParentId={category.id}
              trigger={<Button variant="ghost" size="icon-sm" aria-label={`为 ${category.name} 新增子分类`}><PlusIcon /></Button>}
            />
          )}
          <SourceCategoryDialog
            organizationId={organizationId}
            category={category}
            topLevelCategories={topLevelCategories}
            trigger={<Button variant="ghost" size="icon-sm" aria-label={`编辑 ${category.name}`}><PencilIcon /></Button>}
          />
          <ConfirmDeleteDialog
            trigger={<Button variant="ghost" size="icon-sm" aria-label={`删除 ${category.name}`}><Trash2Icon /></Button>}
            title={`删除分类"${category.name}"？`}
            description="如果该分类下还有子分类，或已被待处理信息引用，删除会被拒绝。"
            mutationFn={() => deleteSourceCategory(category.id, organizationId)}
            invalidateKeys={[["source-categories", organizationId]]}
            successMessage="分类已删除。"
          />
        </div>
      )}
    </div>
  )
}

function CategoryTreeNode({ node, organizationId, canManage, topLevelCategories }: {
  node: SourceCategoryNode
  organizationId: string
  canManage: boolean
  topLevelCategories: SourceCategory[]
}) {
  if (node.children.length === 0) {
    return (
      <div className="border-b last:border-b-0">
        <CategoryRow category={node} organizationId={organizationId} canManage={canManage} topLevelCategories={topLevelCategories} allowAddChild />
      </div>
    )
  }

  return (
    <Collapsible defaultOpen className="border-b last:border-b-0">
      <div className="flex items-center gap-1">
        <CollapsibleTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`展开/收起 ${node.name}`} className="group/category-trigger" />}>
          <ChevronRightIcon className="size-4 transition-transform group-aria-expanded/category-trigger:rotate-90" />
        </CollapsibleTrigger>
        <div className="flex-1">
          <CategoryRow category={node} organizationId={organizationId} canManage={canManage} topLevelCategories={topLevelCategories} allowAddChild />
        </div>
      </div>
      <CollapsibleContent>
        {node.children.map((child) => (
          <CategoryRow key={child.id} category={child} organizationId={organizationId} canManage={canManage} topLevelCategories={topLevelCategories} indent />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SourceCategoriesPage() {
  const workspaceQuery = useQuery({ queryKey: workspaceKey, queryFn: getContentWorkspace })
  const organizationId = workspaceQuery.data?.organization?.id
  const canManage = Boolean(workspaceQuery.data?.canManage)

  const categoriesQuery = useQuery({
    queryKey: ["source-categories", organizationId],
    queryFn: () => getSourceCategories(organizationId!),
    enabled: Boolean(organizationId),
  })

  if (workspaceQuery.isLoading) return <p className="text-sm text-muted-foreground">正在加载分类管理…</p>
  if (workspaceQuery.isError) return <Alert variant="destructive"><AlertTitle>无法加载分类管理</AlertTitle><AlertDescription>{workspaceQuery.error.message}</AlertDescription></Alert>
  if (!organizationId) return <Alert><AlertTitle>账号尚未加入组织</AlertTitle><AlertDescription>请先完成组织和 Owner 初始化。</AlertDescription></Alert>

  const categories = categoriesQuery.data ?? []
  const tree = buildSourceCategoryTree(categories)
  const topLevelCategories = categories.filter((category) => category.parentId === null)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Source taxonomy"
        title="分类管理"
        description="维护信息源的分类体系，决定新线索进入待处理信息后如何归类和路由。最多两层，一次性加载并按排序号显示。"
        actions={canManage && (
          <SourceCategoryDialog
            organizationId={organizationId}
            topLevelCategories={topLevelCategories}
            trigger={<Button><PlusIcon />新建顶级分类</Button>}
          />
        )}
      />

      {categoriesQuery.isError && <Alert variant="destructive"><AlertTitle>无法读取分类列表</AlertTitle><AlertDescription>{categoriesQuery.error.message}</AlertDescription></Alert>}
      {categoriesQuery.isLoading && <p className="text-sm text-muted-foreground">正在读取分类列表…</p>}

      {!categoriesQuery.isLoading && !categoriesQuery.isError && tree.length === 0 && (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FolderTreeIcon /></EmptyMedia>
            <EmptyTitle>还没有分类</EmptyTitle>
            <EmptyDescription>从新建第一个顶级分类开始。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {tree.length > 0 && (
        <Card>
          <CardContent>
            {tree.map((node) => (
              <CategoryTreeNode
                key={node.id}
                node={node}
                organizationId={organizationId}
                canManage={canManage}
                topLevelCategories={topLevelCategories}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
