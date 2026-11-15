// Single source of user-visible brand text for the reader site.
// Mirrors the naming rules in the repository README (星火工厂 · Signal to Story).
export const brandConfig = {
  productName: "星火工厂 · Signal to Story",
  chineseName: "星火工厂",
  englishName: "Signal to Story",
  tagline: "企业 AI 实战、AI 知识科普、工具与工作流、故事与创意",
  companyName: "susesne.cn",
  browserTitle: "星火工厂 · Signal to Story",
  copyrightText: `© ${new Date().getFullYear()} susesne.cn`,
  logo: null as string | null,
} as const

export function pageTitle(title?: string) {
  return title ? `${title} · ${brandConfig.chineseName}` : brandConfig.browserTitle
}
