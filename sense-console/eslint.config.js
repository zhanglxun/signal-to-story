import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

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
  // Project boundaries (docs/architecture.md §4, R2): browser code never imports workers / supabase / the
  // reader site, and never uses Node built-ins (no spawn in the browser). dev/, e2e/ and scripts/ are tooling.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/workers/**', '**/sense-site/**', '**/supabase/functions/**'], message: 'sense-console must not import other projects (docs/architecture.md §4).' },
          { group: ['node:*', 'fs', 'fs/*', 'path', 'os', 'child_process', 'net', 'http', 'https', 'worker_threads'], message: 'Browser code must not use Node built-ins.' },
        ],
      }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // no-restricted-imports does not see import() or require().
      'no-restricted-syntax': ['error',
        { selector: "ImportExpression[source.value=/(^|\\/)(workers|sense-site|supabase\\/functions)\\//]", message: 'sense-console must not import other projects (docs/architecture.md §4).' },
        { selector: "CallExpression[callee.name='require']", message: 'Browser code must not use require().' },
      ],
    },
  },
  {
    files: ['src/test/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/workers/**', '**/sense-site/**', '**/supabase/functions/**'], message: 'sense-console must not import other projects (docs/architecture.md §4).' },
        ],
      }],
    },
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
