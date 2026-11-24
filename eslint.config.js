import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

// Runtime side only; sense-console and sense-site lint themselves.

const CROSS_PROJECT = [
  { group: ["**/sense-console/**", "**/sense-site/**"], message: "Runtime code must not import the Web apps (docs/architecture.md §4)." },
]
const NODE_BUILTINS = ["fs", "fs/promises", "path", "os", "child_process", "net", "http", "https", "crypto", "process", "worker_threads", "stream"]
// workers/agent layers that loop/ must not reach into, at any relative depth.
const LAYER_DIRS = ["drivers", "entry", "backends", "handlers", "delivery"]

export default defineConfig([
  globalIgnores(["sense-console", "sense-site", "knowledge-base", "docs", "**/node_modules", "**/dist", "workers/video"]),
  {
    files: ["**/*.{ts,js}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // Project boundaries (docs/architecture.md §4, R2): the runtime side never imports the Web apps.
  {
    files: ["**/*.{ts,js}"],
    rules: { "no-restricted-imports": ["error", { patterns: CROSS_PROJECT }] },
  },
  // workers/agent/loop is pure logic: no drivers / entry / backends, no Node built-ins, no env, no network.
  {
    files: ["workers/agent/loop/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          ...CROSS_PROJECT,
          { group: LAYER_DIRS.flatMap((d) => [`**/${d}`, `**/${d}/**`]), message: "loop/ must not depend on drivers/entry/backends/handlers/delivery; put the interface in loop/ and the implementation outside." },
          { group: ["node:*"], message: "loop/ is pure logic: no Node built-ins." },
        ],
        paths: NODE_BUILTINS.map((name) => ({ name, message: "loop/ is pure logic: no Node built-ins." })),
      }],
      "no-restricted-properties": ["error", { object: "process", property: "env", message: "loop/ must not read process.env; pass configuration in." }],
      "no-restricted-globals": ["error", { name: "fetch", message: "loop/ must not use the network; call through an injected client." }],
    },
  },
])
