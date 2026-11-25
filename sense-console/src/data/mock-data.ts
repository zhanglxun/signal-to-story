export type WorkTask = { id: string; name: string; agent: string; status: string; progress: number; topic: string; updatedAt: string }
export type Asset = { id: string; name: string; kind: string; status: string; relatedTo: string; size: string; updatedAt: string }

export const tasks: WorkTask[] = [
  { id: "task-1042", name: "整理夜经济一手访谈与事实卡", agent: "Research Agent", status: "执行中", progress: 68, topic: "城市夜经济里的微型创业者", updatedAt: "刚刚" },
  { id: "task-1041", name: "生成非遗主题三幕故事结构", agent: "Story Agent", status: "待审核", progress: 100, topic: "当 AI 成为非遗手艺人的新学徒", updatedAt: "9 分钟前" },
  { id: "task-1038", name: "拆分人物关系与场景需求", agent: "Planning Agent", status: "已完成", progress: 100, topic: "当 AI 成为非遗手艺人的新学徒", updatedAt: "1 小时前" },
  { id: "task-1035", name: "采集社区空间公开素材", agent: "Asset Agent", status: "异常", progress: 34, topic: "独居青年如何重建社区连接", updatedAt: "2 小时前" },
]

export const assets: Asset[] = [
  { id: "asset-901", name: "夜市摊主 · 人物情绪板", kind: "人物设定", status: "待审核", relatedTo: "城市夜经济里的微型创业者", size: "12 张", updatedAt: "6 分钟前" },
  { id: "asset-898", name: "榫卯工坊 · 主场景概念", kind: "场景建模", status: "已完成", relatedTo: "当 AI 成为非遗手艺人的新学徒", size: "4K · 28 MB", updatedAt: "42 分钟前" },
  { id: "asset-887", name: "序章旁白 v3", kind: "音频", status: "执行中", relatedTo: "当 AI 成为非遗手艺人的新学徒", size: "02:18", updatedAt: "1 小时前" },
  { id: "asset-875", name: "社区厨房 · 分镜序列", kind: "分镜", status: "草稿", relatedTo: "独居青年如何重建社区连接", size: "18 镜", updatedAt: "昨天" },
  { id: "asset-862", name: "海边晨雾延时片段", kind: "视频", status: "已完成", relatedTo: "海岸线上的零碳民宿实验", size: "00:34 · 86 MB", updatedAt: "8 月 20 日" },
]
