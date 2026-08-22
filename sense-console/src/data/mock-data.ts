export type Topic = { id: string; title: string; signal: string; status: string; score: number; owner: string; updatedAt: string }
export type WorkTask = { id: string; name: string; agent: string; status: string; progress: number; topic: string; updatedAt: string }
export type Asset = { id: string; name: string; kind: string; status: string; relatedTo: string; size: string; updatedAt: string }

export const topics: Topic[] = [
  { id: "topic-001", title: "城市夜经济里的微型创业者", signal: "趋势雷达 · 社交讨论", status: "待审核", score: 92, owner: "Research Agent", updatedAt: "12 分钟前" },
  { id: "topic-002", title: "当 AI 成为非遗手艺人的新学徒", signal: "行业情报 · 文化科技", status: "执行中", score: 87, owner: "Story Agent", updatedAt: "38 分钟前" },
  { id: "topic-003", title: "独居青年如何重建社区连接", signal: "用户洞察 · 城市生活", status: "草稿", score: 81, owner: "内容主理人", updatedAt: "昨天 18:20" },
  { id: "topic-004", title: "海岸线上的零碳民宿实验", signal: "品牌需求 · 可持续", status: "已完成", score: 78, owner: "Archive", updatedAt: "8 月 20 日" },
]

export const tasks: WorkTask[] = [
  { id: "task-1042", name: "整理夜经济一手访谈与事实卡", agent: "Research Agent", status: "执行中", progress: 68, topic: topics[0].title, updatedAt: "刚刚" },
  { id: "task-1041", name: "生成非遗主题三幕故事结构", agent: "Story Agent", status: "待审核", progress: 100, topic: topics[1].title, updatedAt: "9 分钟前" },
  { id: "task-1038", name: "拆分人物关系与场景需求", agent: "Planning Agent", status: "已完成", progress: 100, topic: topics[1].title, updatedAt: "1 小时前" },
  { id: "task-1035", name: "采集社区空间公开素材", agent: "Asset Agent", status: "异常", progress: 34, topic: topics[2].title, updatedAt: "2 小时前" },
]

export const assets: Asset[] = [
  { id: "asset-901", name: "夜市摊主 · 人物情绪板", kind: "人物设定", status: "待审核", relatedTo: topics[0].title, size: "12 张", updatedAt: "6 分钟前" },
  { id: "asset-898", name: "榫卯工坊 · 主场景概念", kind: "场景建模", status: "已完成", relatedTo: topics[1].title, size: "4K · 28 MB", updatedAt: "42 分钟前" },
  { id: "asset-887", name: "序章旁白 v3", kind: "音频", status: "执行中", relatedTo: topics[1].title, size: "02:18", updatedAt: "1 小时前" },
  { id: "asset-875", name: "社区厨房 · 分镜序列", kind: "分镜", status: "草稿", relatedTo: topics[2].title, size: "18 镜", updatedAt: "昨天" },
  { id: "asset-862", name: "海边晨雾延时片段", kind: "视频", status: "已完成", relatedTo: topics[3].title, size: "00:34 · 86 MB", updatedAt: "8 月 20 日" },
]
