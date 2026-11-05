# Signal to Story repository instructions

## Before changing the project

- Read `README.md` and the relevant files under `docs-site/spec/`, `docs-site/design/`, and `docs-site/plan/`.
- Put application code under `sense-console/` unless a specification explicitly says otherwise.
- The user-facing product name is `Signal to Story`; `sense-console` is only the engineering directory name.

## Architecture boundaries

- `sense-console` is the visual control plane. Do not run long AI or media jobs in the browser.
- Use Supabase Auth and RLS-protected Data API calls for ordinary CRUD; do not add a traditional backend API without an approved need.
- Never expose `service_role`, database passwords, provider secrets, or other privileged keys to browser code.
- Agents submit proposals or drafts. They must not approve, publish, delete, or directly overwrite Obsidian source documents.
- Store media binaries in object storage and relational metadata in Postgres.
- Do not create Worker or shared-package infrastructure until a real long-running or cross-runtime requirement exists.

## Frontend conventions

- Use React, TypeScript strict, Vite, React Router, Tailwind CSS, and shadcn/ui with Base UI.
- Do not add a second component library or duplicate existing UI primitives.
- Keep navigation to at most two levels.
- Use semantic theme tokens; do not scatter raw brand or status colors through pages.
- Keep page components focused and move reusable data access to `src/services/`.

## Verification

Run the relevant checks before handing off changes:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Run E2E checks when the environment supports them.

## Cursor Cloud specific instructions

- npm scripts live in `sense-console/`. Run install, dev, typecheck, lint, test, and build from that directory. The repository root has no application `package.json`.
- Dev server: `npm run dev -- --host 0.0.0.0 --port 5173` inside `sense-console`. A boot script should skip startup when `http://127.0.0.1:5173/` already responds.
- `sense-console/.env.local` is optional for boot. Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, `/dashboard` redirects to `/login`, the form shows “认证尚未配置”, and submit stays disabled. Do not add an auth bypass.
- `npm run test:e2e` uses Playwright Chromium and its own Vite server on `http://127.0.0.1:4173`. Install the browser with `npx playwright install chromium` from `sense-console` when the cache is missing.
