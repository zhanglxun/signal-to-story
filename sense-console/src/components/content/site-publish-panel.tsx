import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RocketIcon, Wand2Icon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import type { ContentDocument } from "@/contracts/content"
import { isLiveOnSite } from "@/contracts/site-publish"
import { useContentAction } from "@/hooks/use-content-action"
import {
  sitePublishState,
  suggestSiteSlug,
  suggestSiteSummary,
} from "@/lib/site-publish-step"
import { setPublishedUrl } from "@/services/content-service"
import {
  decideSitePublishApproval,
  listSitePublishApprovals,
  publishDocument,
  publishWithApproval,
  requestSitePublishApproval,
  unpublishDocument,
} from "@/services/site-publish-service"

const stepHint = {
  not_approved: "稿件审核通过后才能发布到读者站。",
  request: "填写展示信息后，可一键批准并发布，或先提交发布批准请求。",
  wait_decision: "已有待批准的发布请求，等待具有发布权限的成员批准。",
  publish: "批准已生效，可以发布到读者站。",
  published: "该版本已在读者站上线。",
} as const

/**
 * Publish an approved revision to the reader site (copied into the document's published_* columns) and record
 * the link of a manual publication elsewhere. The database enforces the Mandate (approval bound to the revision).
 */
export function SitePublishPanel({
  document,
  canRequest,
  canPublish,
  embedded = false,
}: {
  document: ContentDocument
  canRequest: boolean
  canPublish: boolean
  embedded?: boolean
}) {
  const slugFieldId = useId()
  const summaryFieldId = useId()
  const urlFieldId = useId()

  const { busy, run } = useContentAction()
  const approvals = useQuery({
    queryKey: ["document-history", document.id, "site-approvals"],
    queryFn: () => listSitePublishApprovals(document.id),
  })

  const [slug, setSlug] = useState(document.slug ?? "")
  const [summary, setSummary] = useState("")
  const [rejectReason, setRejectReason] = useState("")
  const [externalUrl, setExternalUrl] = useState(document.published_url ?? "")

  const state = sitePublishState({
    documentStatus: document.status,
    revision: document.revision,
    approvals: approvals.data ?? [],
    publishedRevision: document.published_revision ?? null,
    publishedAt: document.published_at ?? null,
  })
  const live = isLiveOnSite(document)
  const everPublished = document.published_revision != null

  if (document.status !== "approved" && !everPublished && !document.published_url) return null

  const meta = { slug: slug.trim().toLowerCase(), summary: summary.trim() }

  function applySuggestedMeta() {
    setSlug(suggestSiteSlug(document.title, document.id))
    setSummary(suggestSiteSummary(document.body, document.title))
  }

  const content = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p data-testid="site-step" className="text-sm text-muted-foreground">
          {stepHint[state.step]}
        </p>
        {(state.step === "request" || state.step === "publish") && (
          <Button type="button" variant="ghost" size="sm" onClick={applySuggestedMeta}>
            <Wand2Icon className="size-3.5" />
            自动填充建议
          </Button>
        )}
      </div>

      {state.staleApprovals && (
        <Alert variant="destructive">
          <AlertDescription>
            稿件版本已变化，旧版本的发布批准已失效，需要对当前版本重新批准。
          </AlertDescription>
        </Alert>
      )}
      {state.lastOutcome === "rejected" && (
        <Alert variant="destructive">
          <AlertDescription>
            上次批准请求被拒绝
            {state.approval?.reason ? `：${state.approval.reason}` : ""}
            。可修改后重新请求。
          </AlertDescription>
        </Alert>
      )}
      {state.lastOutcome === "expired" && (
        <Alert variant="destructive">
          <AlertDescription>发布批准已过期，请重新请求批准。</AlertDescription>
        </Alert>
      )}

      {(state.step === "request" || state.step === "publish") && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={slugFieldId}>站点链接标识（slug）</FieldLabel>
            <Input
              id={slugFieldId}
              value={slug}
              maxLength={96}
              placeholder="agent-basics"
              onChange={(e) => setSlug(e.target.value)}
            />
            <FieldDescription>仅小写字母、数字和连字符</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={summaryFieldId}>人工摘要（1–500 字）</FieldLabel>
            <Textarea
              id={summaryFieldId}
              value={summary}
              maxLength={500}
              rows={3}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>
        </FieldGroup>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {state.step === "request" && canRequest && canPublish && (
          <Button
            disabled={busy || !meta.slug || !meta.summary}
            onClick={() =>
              void run(async () => {
                await publishWithApproval({
                  organizationId: document.organization_id,
                  documentId: document.id,
                  revision: document.revision,
                  meta,
                  existingApproval: state.approval,
                })
              }, "已完成批准并发布到读者站")
            }
          >
            <RocketIcon className="size-4" />
            一键批准并发布
          </Button>
        )}

        {state.step === "request" && (
          <Button
            variant={canRequest && canPublish ? "outline" : "default"}
            disabled={busy || !canRequest || !meta.slug || !meta.summary}
            onClick={() =>
              void run(
                () =>
                  requestSitePublishApproval({
                    organizationId: document.organization_id,
                    documentId: document.id,
                    revision: document.revision,
                    slug: meta.slug,
                    summary: meta.summary,
                  }),
                "已提交发布批准请求"
              )
            }
          >
            请求发布批准
          </Button>
        )}

        {state.step === "wait_decision" && state.approval && (
          <>
            <Button
              disabled={busy || !canPublish}
              onClick={() =>
                void run(() => decideSitePublishApproval(state.approval!.id, "approved"), "已批准发布")
              }
            >
              批准
            </Button>
            <Input
              className="max-w-60"
              value={rejectReason}
              placeholder="拒绝原因"
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || !canPublish || !rejectReason.trim()}
              onClick={() =>
                void run(
                  () => decideSitePublishApproval(state.approval!.id, "rejected", rejectReason.trim()),
                  "已拒绝"
                )
              }
            >
              拒绝
            </Button>
            {!canPublish && (
              <span className="text-xs text-muted-foreground">批准需要发布权限（content.publish）。</span>
            )}
          </>
        )}

        {state.step === "publish" && (
          <Button
            disabled={busy || !canPublish || !meta.slug || !meta.summary}
            onClick={() =>
              void run(async () => {
                await publishDocument(document.id, document.revision, meta)
              }, "已发布到读者站")
            }
          >
            发布到读者站
          </Button>
        )}

        {state.step === "request" && !canRequest && (
          <span className="text-xs text-muted-foreground">请求批准需要内容管理权限。</span>
        )}
        {state.step === "publish" && !canPublish && (
          <span className="text-xs text-muted-foreground">发布需要发布权限（content.publish）。</span>
        )}
      </div>

      {everPublished && (
        <>
          <Separator />
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
            <Badge>{live ? "读者站已上线" : "读者站已下线"}</Badge>
            <span>稿件 v{document.published_revision}</span>
            <span className="text-muted-foreground">
              {document.slug ? `/${document.slug}` : ""}
              {document.published_at ? ` · ${new Date(document.published_at).toLocaleString()}` : ""}
            </span>
            {live && document.published_revision !== document.revision && (
              <span className="text-xs text-muted-foreground">线上仍是 v{document.published_revision}，当前稿件修改不影响已发布内容。</span>
            )}
            {live && canPublish && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => unpublishDocument(document.id), "已从读者站下线")}
              >
                下线
              </Button>
            )}
          </div>
        </>
      )}

      <Separator />
      <Field>
        <FieldLabel htmlFor={urlFieldId}>外部平台发布链接（人工发布后回填）</FieldLabel>
        <div className="flex flex-wrap gap-2">
          <Input
            id={urlFieldId}
            className="min-w-64 flex-1"
            value={externalUrl}
            placeholder="https://"
            disabled={!canPublish}
            onChange={(e) => setExternalUrl(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || !canPublish || externalUrl.trim() === (document.published_url ?? "")}
            onClick={() => void run(() => setPublishedUrl(document.id, externalUrl), externalUrl.trim() ? "已登记发布链接" : "已清除发布链接")}
          >
            保存链接
          </Button>
        </div>
        <FieldDescription>只记录链接，不抓取阅读数据。</FieldDescription>
      </Field>
    </div>
  )

  if (embedded) return content

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>发布</span>
          <Badge variant="outline">v{document.revision}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
