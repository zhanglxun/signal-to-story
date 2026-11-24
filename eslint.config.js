import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"

// Runtime side only; sense-console and sense-site lint themselves.

const CROSS_PROJECT = [
  { group: ["**/sense-console/**", "**/sense-site/**"], message: "Runtime code must not import the Web apps (docs/architecture.md §4)." },
]
const NODE_BUILTINS = ["fs", "fs/*", "path", "os", "child_process", "net", "http", "https", "crypto", "process", "worker_threads", "stream"]

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
          { group: ["../drivers", "../drivers/*", "../entry", "../entry/*", "../backends", "../backends/*", "../handlers", "../handlers/*", "../delivery", "../delivery/*"], message: "loop/ must not depend on drivers/entry/backends/handlers/delivery; put the interface in loop/ and the implementation outside." },
          { group: ["node:*", ...NODE_BUILTINS], message: "loop/ is pure logic: no Node built-ins." },
        ],
      }],
      "no-restricted-properties": ["error", { object: "process", property: "env", message: "loop/ must not read process.env; pass configuration in." }],
      "no-restricted-globals": ["error", { name: "fetch", message: "loop/ must not use the network; call through an injected client." }],
    },
  },
])
