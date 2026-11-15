/** Pure builders for the "more capture entries" generator (browser bookmarklet + iOS Shortcut). */

export const INTAKE_GATEWAY_PATH = "/functions/v1/intake-gateway"

export function intakeEndpoint(supabaseUrl: string | undefined): string {
  const base = (supabaseUrl ?? "").trim().replace(/\/+$/, "")
  return `${base || "https://<project-ref>.supabase.co"}${INTAKE_GATEWAY_PATH}`
}

/**
 * Bookmarklet: opens the console's /capture page prefilled with the current page URL and title.
 * It never carries a token or any key: the console session (login + RLS) authorizes the capture,
 * and intake-gateway deliberately rejects browser cross-origin calls.
 */
export function buildBookmarklet(consoleOrigin: string): string {
  const origin = consoleOrigin.replace(/\/+$/, "")
  const code = `(function(){var u=encodeURIComponent(location.href),t=encodeURIComponent(document.title||'');window.open(${JSON.stringify(origin)}+'/capture?u='+u+'&t='+t,'_blank','noopener');})();`
  return `javascript:${code}`
}

/** Prefill text for /capture from the bookmarklet query params. Returns "" when nothing usable. */
export function captureRawFromParams(params: URLSearchParams): string {
  const u = (params.get("u") ?? "").trim()
  const t = (params.get("t") ?? "").trim().slice(0, 200)
  if (!/^https?:\/\/\S+$/i.test(u)) return ""
  return t ? `${u}\n${t}` : u
}

export interface ShortcutConfig {
  endpoint: string
  method: "POST"
  headers: Record<string, string>
  body: Record<string, unknown>
  steps: string[]
}

/**
 * iOS Shortcut setup for the Share Sheet. The token is only substituted into the displayed config;
 * callers must keep it in component state (never persisted).
 */
export function buildShortcutConfig(input: { endpoint: string; token: string }): ShortcutConfig {
  const token = input.token.trim()
  return {
    endpoint: input.endpoint,
    method: "POST",
    headers: { Authorization: `Bearer ${token || "stk_<在外部接入页创建的收录令牌>"}`, "Content-Type": "application/json" },
    body: {
      version: 1,
      intent: "capture",
      external_id: "ios:<快捷指令变量：当前日期（ISO 8601，含秒）>",
      text: "<快捷指令变量：快捷指令输入>",
      url: "<快捷指令变量：快捷指令输入中的 URL（可省略）>",
    },
    steps: [
      "打开「快捷指令」App，新建快捷指令，在详情里开启「在共享表单中显示」，接受类型选「URL」与「文本」。",
      "添加操作「获取 URL 内容」：URL 填下方接口地址，方法选 POST，请求正文选 JSON。",
      "添加请求头 Authorization 与 Content-Type（值见下方配置）；JSON 字段按下方正文填写，变量用「快捷指令输入」「当前日期」。",
      "external_id 必须每次分享都不同，同一条消息重试时才会被防重；因此用当前日期（精确到秒）拼接。",
      "再添加「显示通知」展示返回的 receipt_id；返回 401 说明令牌失效，请到外部接入页重新创建。",
    ],
  }
}
