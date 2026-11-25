import { createHash } from "node:crypto"
import { expect, test } from "@playwright/test"

// A non-loopback HTTP origin: localhost is trusted by Chromium and would hide this bug.
// Proxy only the test frontend through Playwright; no real credentials or DB writes.
for (const protocol of ["http", "https"] as const) {
  test(`${protocol.toUpperCase()} origin creates a gateway-compatible credential`, async ({
    page,
  }) => {
    const origin = `${protocol}://spark-intake.test:4173`
    await page.route(`${origin}/**`, async (route) => {
      if (route.request().isNavigationRequest()) {
        await route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>HTTP credential test</title>",
        })
      } else {
        const response = await route.fetch({
          url: route.request().url().replace(origin, "http://127.0.0.1:4173"),
        })
        await route.fulfill({ response })
      }
    })
    await page.goto(origin)
    const result = await page.evaluate(async () => {
      const path = "/src/lib/intake-credentials.ts"
      const { generateIntakeCredential } = await import(/* @vite-ignore */ path)
      return {
        secure: window.isSecureContext,
        hasSubtle: Boolean(crypto.subtle),
        ...generateIntakeCredential(),
      }
    })
    expect(result.secure).toBe(protocol === "https")
    expect(result.hasSubtle).toBe(protocol === "https")
    expect(result.token).toMatch(/^stk_[a-f0-9]{64}$/)
    expect(result.hash).toBe(
      createHash("sha256").update(result.token).digest("hex")
    )
  })
}
