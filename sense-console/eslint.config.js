import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { builtinModules } from 'node:module'

// Project boundaries (docs/architecture.md §4). Other projects are only reachable by walking up out of
// sense-console, so match relative paths; a glob such as **/supabase would also hit @/lib/supabase.
const CROSS_PROJECT_MESSAGE = 'sense-console must not import other projects (docs/architecture.md §4).'
const CROSS_PROJECT_SYNTAX = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].map((node) => ({
  selector: `${node}[source.value=/^(\\.\\.\\/)+(workers|sense-site|supabase)(\\/|$)/]`,
  message: CROSS_PROJECT_MESSAGE,
}))
// Exact names (incl. subpaths like fs/promises), so @/lib/path or ./os are not mistaken for built-ins.
const NODE_BUILTINS = builtinModules.filter((name) => !name.startsWith('_'))

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // Browser code: no other projects, no Node built-ins, no require (cross-review #7, 2026-11-24).
  // dev/, e2e/ and scripts/ are Node tooling and are not covered.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['node:*'], message: 'Browser code must not use Node built-ins.' }],
        paths: NODE_BUILTINS.map((name) => ({ name, message: 'Browser code must not use Node built-ins.' })),
      }],
      'no-restricted-syntax': ['error',
        ...CROSS_PROJECT_SYNTAX,
        { selector: 'ImportExpression[source.value=/^node:/]', message: 'Browser code must not use Node built-ins.' },
        { selector: "CallExpression[callee.name='require']", message: 'Browser code must not use require().' },
      ],
    },
  },
  // Tests run in Node: built-ins are fine there; the cross-project rule above still applies.
  {
    files: ['src/test/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: [
      'src/components/chart-area-interactive.tsx',
      'src/hooks/use-mobile.ts',
      'src/hooks/use-story-scope.ts',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
