import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.{ts,tsx}", "workers/**/*.test.ts", "adapters/**/*.test.ts"],
    // PGlite boots a WASM Postgres and applies every migration per test file.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    css: true,
  },
})
