import { Link } from "react-router"
import { FileAudioIcon, FileImageIcon, FilmIcon, Grid2X2Icon, ListIcon, ScanFaceIcon } from "lucide-react"

import { ListToolbar } from "@/components/list-toolbar"
import { PageHeader } from "@/components/page-header"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { assets } from "@/data/mock-data"

function AssetIcon({ kind }: { kind: string }) {
  const Icon = kind === "音频" ? FileAudioIcon : kind === "视频" || kind === "分镜" ? FilmIcon : kind === "人物设定" ? ScanFaceIcon : FileImageIcon
  return <Icon className="size-8 text-muted-foreground" />
}

export function AssetsPage() {
  return <div className="flex flex-col gap-6"><PageHeader eyebrow="Creative library" title="内容资产" description="按故事关系组织图片、音频、人物、场景、分镜和视频；控制台记录元数据与存储地址。" actions={<div className="flex rounded-lg border p-1"><Button size="icon-sm" variant="secondary"><Grid2X2Icon /></Button><Button size="icon-sm" variant="ghost"><ListIcon /></Button></div>} /><ListToolbar placeholder="搜索资产名称、类型或关联选题" action="登记资产" /><section className="grid gap-4 sm:grid-cols-2 @5xl/main:grid-cols-3">{assets.map((asset) => <Card key={asset.id}><CardHeader><div className="flex items-start justify-between gap-3"><CardTitle className="truncate"><Link to={`/assets/${asset.id}`} className="hover:underline">{asset.name}</Link></CardTitle><StatusBadge status={asset.status} /></div></CardHeader><CardContent><Link to={`/assets/${asset.id}`} className="flex aspect-video items-center justify-center rounded-lg border bg-muted/50"><AssetIcon kind={asset.kind} /><span className="sr-only">打开 {asset.name}</span></Link><p className="mt-3 truncate text-sm text-muted-foreground">{asset.relatedTo}</p></CardContent><CardFooter className="justify-between text-xs text-muted-foreground"><span>{asset.kind} · {asset.size}</span><span>{asset.updatedAt}</span></CardFooter></Card>)}</section></div>
}
