# Signal to Story repository instructions

## Before changing the project

- Read `README.md`, `docs/architecture.md`, and the relevant files under `docs/` (index: `docs/README.md`).
- Put application code under `sense-console/` unless a specification explicitly says otherwise.
- The user-facing product name is `Signal to Story`; `sense-console` is only the engineering directory name.

## Architecture boundaries

- `sense-console` is the visual control plane. Do not run long AI or media jobs in the browser.
- Use Supabase Auth and RLS-protected Data API calls for ordinary CRUD; do not add a traditional backend API without an approved need.
- Never expose `service_role`, database passwords, provider secrets, or other privileged keys to browser code.
- Agents submit proposals or drafts; humans retain approval and publishing authority. They must not bypass Mandate database gates or directly approve, publish, delete, or overwrite approved/published documents.
- Store media binaries in object storage and relational metadata in Postgres.
- Long-running Agent/Media tasks run in independent `sense-console/workers/` processes (`agent/`, later `video/`), never in browser code; monorepo and `packages/` shared infrastructure remain forbidden until a real cross-runtime requirement exists.

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
