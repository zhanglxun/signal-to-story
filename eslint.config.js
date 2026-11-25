import js from "@eslint/js"
import globals from "globals"
import tseslint from "typescript-eslint"
import { defineConfig, globalIgnores } from "eslint/config"
import { builtinModules } from "node:module"

// Runtime side only; sense-console and sense-site lint themselves.

const CROSS_PROJECT = [
  { group: ["**/sense-console/**", "**/sense-site/**"], message: "Runtime code must not import the Web apps (docs/architecture.md §4)." },
]
const CROSS_PROJECT_DYNAMIC = [
  { selector: "ImportExpression[source.value=/sense-(console|site)\\//]", message: "Runtime code must not import the Web apps (docs/architecture.md §4)." },
  { selector: "CallExpression[callee.name='require'][arguments.0.value=/sense-(console|site)\\//]", message: "Runtime code must not import the Web apps (docs/architecture.md §4)." },
]
// Every Node built-in (incl. subpaths such as fs/promises, stream/promises); "node:*" is a pattern below.
const NODE_BUILTINS = builtinModules.filter((name) => !name.startsWith("_"))
// workers/agent layers that loop/ must not reach into, at any relative depth.
const LAYER_DIRS = ["drivers", "entry", "backends", "handlers", "delivery"]

export default defineConfig([
  globalIgnores(["sense-console", "sense-site", "knowledge-base", "docs", "**/node_modules", "**/dist", "workers/video", ".claude"]),
  {
    files: ["**/*.{ts,js}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // Project boundaries (docs/architecture.md §4, R2): the runtime side never imports the Web apps.
  {
    files: ["**/*.{ts,js}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: CROSS_PROJECT }],
      // no-restricted-imports does not see import() or require(); catch cross-project ones here.
      "no-restricted-syntax": ["error", ...CROSS_PROJECT_DYNAMIC],
    },
  },
  // workers/agent/loop is pure logic: nothing outside loop/ (drivers, entry, config, runner, notify, …),
  // no Node built-ins, no env, no network, no dynamic loading. Leaving loop/ is detected by counting
  // "../" segments for each folder depth (cross-review #7, 2026-11-24).
  ...[1, 2, 3].map((depth) => ({
    files: [`workers/agent/loop/${"*/".repeat(depth - 1)}*.{ts,js}`],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          ...CROSS_PROJECT,
          { group: LAYER_DIRS.flatMap((d) => [`**/${d}`, `**/${d}/**`]), message: "loop/ must not depend on drivers/entry/backends/handlers/delivery; put the interface in loop/ and the implementation outside." },
          { group: ["node:*"], message: "loop/ is pure logic: no Node built-ins." },
        ],
        paths: NODE_BUILTINS.map((name) => ({ name, message: "loop/ is pure logic: no Node built-ins." })),
      }],
      "no-restricted-properties": ["error",
        { object: "process", property: "env", message: "loop/ must not read process.env; pass configuration in." },
        { object: "globalThis", property: "fetch", message: "loop/ must not use the network; call through an injected client." },
        { object: "globalThis", property: "process", message: "loop/ must not reach process; pass configuration in." },
      ],
      "no-restricted-globals": ["error", { name: "fetch", message: "loop/ must not use the network; call through an injected client." }],
      "no-restricted-syntax": [
        "error",
        ...CROSS_PROJECT_DYNAMIC,
        { selector: "ImportExpression", message: "loop/ is pure logic: no dynamic import()." },
        { selector: "CallExpression[callee.name='require']", message: "loop/ is pure logic: no require()." },
        ...["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].map((node) => ({
          selector: `${node}[source.value=/^(\\.\\.\\/){${depth}}/]`,
          message: "loop/ must not import anything outside loop/ (put an interface in loop/, the implementation outside).",
        })),
      ],
    },
  })),
])
