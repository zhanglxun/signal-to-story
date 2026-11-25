import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"

/**
 * Chat e2e against a FAKE local node and a fake Supabase (e2e/support/fake-chat-node.mjs).
 * Run: npm run test:e2e -- -c e2e/chat.playwright.config.ts
 * No real Supabase project, keys or worker are involved; the dev server gets fake loopback URLs.
 */
const consoleRoot = fileURLToPath(new URL("..", import.meta.url))
const SUPABASE_PORT = 54329
const NODE_PORT = 4319
const WEB_PORT = 4174

// Read by the spec: without it (e.g. under the default playwright.config.ts) the test skips.
process.env.CHAT_E2E_FAKE_NODE = "1"

export default defineConfig({
  testDir: ".",
  testMatch: "chat-fake-node.spec.ts",
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure" },
  webServer: [
    {
      command: "node e2e/support/fake-chat-node.mjs",
      cwd: consoleRoot,
      url: `http://127.0.0.1:${NODE_PORT}/v1/health`,
      reuseExistingServer: false,
      env: { FAKE_SUPABASE_PORT: String(SUPABASE_PORT), FAKE_NODE_PORT: String(NODE_PORT) },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: consoleRoot,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`,
        VITE_SUPABASE_PUBLISHABLE_KEY: "fake-publishable-key",
        VITE_CHAT_TRANSPORT: "http",
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
