#!/usr/bin/env node
// Provider-neutral adapter. Dot can execute this on its connected computer.
import { readFile } from "node:fs/promises"

export async function sendIntake(config, input, fetcher = fetch) {
  const url = new URL(config.endpoint)
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("接入地址必须使用 HTTPS 且不能包含凭证")
  if (!/^stk_[a-f0-9]{64}$/.test(config.token ?? ""))
    throw new Error("接入凭证格式不正确")
  const response = await fetcher(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(
      `收录失败 HTTP ${response.status}: ${body.error ?? "unknown"}。修改请求前保留原 external_id；超时可使用同一原始请求重试。`
    )
  if (body.status !== "captured" || !body.receipt_id || !body.selection_id)
    throw new Error("服务未返回有效收录回执，不能报告成功")
  return body
}

// CLI: node send.mjs /private/credentials.json /private/message.json
if (
  process.argv[1] &&
  import.meta.url ===
    (await import("node:url")).pathToFileURL(process.argv[1]).href
) {
  try {
    const [, , configPath, inputPath] = process.argv
    if (!configPath || !inputPath)
      throw new Error("用法: node send.mjs <连接配置文件> <消息JSON文件>")
    const config = JSON.parse(await readFile(configPath, "utf8"))
    const input = JSON.parse(await readFile(inputPath, "utf8"))
    console.log(JSON.stringify(await sendIntake(config, input), null, 2))
  } catch (e) {
    console.error(e instanceof Error ? e.message : "收录失败")
    process.exitCode = 1
  }
}
