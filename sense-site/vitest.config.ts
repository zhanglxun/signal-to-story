import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.{ts,tsx}"],
    css: true,
    // Tests never talk to a real backend: force demo mode unless a test overrides it.
    env: { VITE_SITE_DEMO: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    testTimeout: 20_000,
  },
})
