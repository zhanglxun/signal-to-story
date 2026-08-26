import { expect, test } from "@playwright/test"

test("signed-out visitors cannot enter protected routes", async ({ page }) => {
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible()
  await expect(page.getByRole("button", { name: /进入演示工作台/ })).toHaveCount(0)
  await expect(page.locator("#password")).toHaveAttribute("type", "password")
})
