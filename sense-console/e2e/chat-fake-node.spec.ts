import { expect, test } from "@playwright/test"

// Runs only under e2e/chat.playwright.config.ts, which starts the fake node + fake Supabase.
// The test account below exists only inside that fake server.
test.skip(!process.env.CHAT_E2E_FAKE_NODE, "Run with: npm run test:e2e -- -c e2e/chat.playwright.config.ts")
test.use({ actionTimeout: 15000 })

test("chat on the real HTTP/SSE transport: send, stop, regenerate, reload", async ({ page }) => {
  test.setTimeout(90000)

  await page.goto("/login")
  await page.locator("#email").fill("e2e-operator@example.test")
  await page.locator("#password").fill("fake-local-password")
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 20000 })

  await page.goto("/chat")
  const input = page.getByLabel("聊天消息输入框")
  await expect(input).toBeEnabled()
  // The selector is filled from runner_nodes (the fake node), not the mock catalog.
  await expect(page.getByRole("button", { name: "选择模型或本地 CLI" })).toContainText("脚本假模型")

  // 1. send → streamed answer
  await input.fill("你好，假节点")
  await page.getByRole("button", { name: "发送" }).click()
  await expect(page.getByText("假节点回答：你好，假节点")).toBeVisible()
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible()

  // 2. stop a slow turn: cancel_agent_job first, the partial reply is stored as cancelled
  await input.fill("请慢慢回答")
  await page.getByRole("button", { name: "发送" }).click()
  await expect(page.getByText(/片段1 /)).toBeVisible()
  await page.getByRole("button", { name: "停止" }).click()
  await expect(page.getByText("已停止")).toBeVisible({ timeout: 20000 })
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible({ timeout: 20000 })

  // 3. regenerate the first answer → version 2
  const firstRegenerate = page.getByRole("button", { name: "重新生成" }).first()
  await firstRegenerate.click()
  await expect(page.getByText("这是第 2 版回答：你好，假节点")).toBeVisible()
  await expect(page.getByText("版本 2 / 2")).toBeVisible()

  // 4. reload keeps the history (read back from chat_messages)
  await page.reload()
  await expect(page.getByText("这是第 2 版回答：你好，假节点")).toBeVisible()
  await expect(page.getByText("版本 2 / 2")).toBeVisible()
  await expect(page.getByText("请慢慢回答")).toBeVisible()

  // The same page works full-screen on /h5/chat.
  await page.goto("/h5/chat")
  await expect(page.getByText("这是第 2 版回答：你好，假节点")).toBeVisible()
})
