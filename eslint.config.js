import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

// Runtime side only; sense-console and sense-site lint themselves.
export default defineConfig([
  globalIgnores(["sense-console", "sense-site", "knowledge-base", "docs", "**/node_modules", "**/dist", "workers/video"]),
  {
    files: ["**/*.{ts,js}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
])
