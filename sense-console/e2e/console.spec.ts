import { expect, test } from "@playwright/test"

test("demo operator can enter and inspect core areas", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: /进入演示工作台/ }).click()
  await expect(page.getByRole("heading", { name: "内容生产驾驶舱" })).toBeVisible()
  await page.getByRole("link", { name: "任务" }).click()
  await expect(page.getByRole("heading", { name: "任务调度" })).toBeVisible()
  await page.getByRole("link", { name: "资产" }).click()
  await expect(page.getByRole("heading", { name: "内容资产" })).toBeVisible()
})
