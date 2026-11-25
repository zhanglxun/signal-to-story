import { defineConfig } from "vitest/config"

// Runtime-side tests. Web tests run from sense-console/ and sense-site/.
export default defineConfig({
  test: {
    environment: "node",
    include: ["workers/**/*.test.ts", "testing/**/*.test.ts", "supabase/**/*.test.ts"],
    // PGlite boots a WASM Postgres and applies every migration per test file.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
