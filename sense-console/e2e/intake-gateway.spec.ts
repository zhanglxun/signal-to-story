import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect, test } from "@playwright/test"
const fixturePath = process.env.INTAKE_E2E_FIXTURE
// Downloads contain scoped secrets. Never record credential creation in traces.
test.use({ trace: "off", video: "off", screenshot: "off" })
test("external assistant -> cloud gateway -> source and topic -> revoke", async ({
  page,
  request,
}) => {
  test.skip(!fixturePath, "Set INTAKE_E2E_FIXTURE to a disposable account")
  test.setTimeout(120000)
  const fixture = JSON.parse(await readFile(fixturePath!, "utf8"))
  const label = `Dot E2E ${Date.now()}`
  const folder = await mkdtemp(join(tmpdir(), "intake-browser-"))
  try {
    await page.goto("/login")
    await page.locator("#email").fill(fixture.email)
    await page.locator("#password").fill(fixture.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expect(page).toHaveURL(/dashboard/, { timeout: 20000 })
    await page.goto("/system/integrations")
    await page.getByLabel("连接名称").fill(label)
    await page.getByRole("button", { name: "生成凭证", exact: true }).click()
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("button", { name: "下载连接配置" }).click()
    const configPath = join(folder, "credentials.json")
    await (await downloadPromise).saveAs(configPath)
    const config = JSON.parse(await readFile(configPath, "utf8"))
    await page.getByRole("button", { name: "已保存，关闭" }).click()
    const payload = {
      version: 1,
      intent: "capture",
      external_id: "dot-e2e-message",
      text: "浏览文章时想到：企业 AI 选题入口测试",
      title: label,
      url: "https://example.com/source",
      angle: "企业实践",
    }
    const messagePath = join(folder, "message.json")
    await writeFile(messagePath, JSON.stringify(payload))
    const result = await promisify(execFile)(process.execPath, [
      "adapters/intake/send.mjs",
      configPath,
      messagePath,
    ])
    const receipt = JSON.parse(result.stdout)
    expect(receipt.status).toBe("captured")
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        request.post(config.endpoint, {
          headers: { Authorization: `Bearer ${config.token}` },
          data: payload,
        })
      )
    )
    for (const r of replies) {
      expect(r.status()).toBe(200)
      const body = await r.json()
      expect(body.selection_id).toBe(receipt.selection_id)
      expect(body.duplicate).toBe(true)
    }
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () =>
        request.post(config.endpoint, {
          headers: { Authorization: `Bearer ${config.token}` },
          data: {
            ...payload,
            external_id: "concurrent-first-delivery",
            title: "并发首次投递验收",
          },
        })
      )
    )
    const bodies = await Promise.all(
      concurrent.map(async (r) => {
        expect(r.status()).toBe(200)
        return r.json()
      })
    )
    expect(new Set(bodies.map((b) => b.selection_id)).size).toBe(1)
    expect(bodies.filter((b) => !b.duplicate)).toHaveLength(1)
    expect(
      (
        await request.post(config.endpoint, {
          headers: { Authorization: `Bearer ${config.token}` },
          data: { ...payload, text: "different" },
        })
      ).status()
    ).toBe(409)
    expect(
      (await request.post(config.endpoint, { data: payload })).status()
    ).toBe(401)
    expect(
      (
        await request.post(config.endpoint, {
          headers: { Authorization: `Bearer ${config.token}` },
          data: { ...payload, organization_id: "other" },
        })
      ).status()
    ).toBe(400)
    await page.reload()
    await page.getByRole("link", { name: payload.title, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/topics/${receipt.selection_id}$`))
    await expect(
      page.getByText(payload.title, { exact: true }).first()
    ).toBeVisible()
    await page.goto("/system/integrations")
    const row = page
      .locator("div.rounded.border.p-3")
      .filter({ hasText: `${label} · dot` })
    await row.getByRole("button", { name: "撤销", exact: true }).click()
    await expect(row.getByText(/已撤销/)).toBeVisible()
    expect(
      (
        await request.post(config.endpoint, {
          headers: { Authorization: `Bearer ${config.token}` },
          data: payload,
        })
      ).status()
    ).toBe(401)
    await page.screenshot({
      path: "/tmp/spark-intake-test/verified-console.png",
      fullPage: true,
    })
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
