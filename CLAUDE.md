# Signal to Story project memory

Read @README.md before making architectural changes.

Also follow:

- @docs/architecture.md (single architecture entry; layers, target layout, call rules, R0–R5 order)
- @docs/README.md (doc index; module docs live in `docs/modules/`)

## Non-negotiable boundaries

- All current application code belongs under `sense-console/`.
- User-facing branding is `Signal to Story`; `sense-console` is an internal directory name.
- The Console is a visual control plane, not a long-running execution engine.
- Ordinary CRUD may call Supabase directly only through publishable credentials and RLS.
- Never put `service_role`, database passwords, or provider secrets in browser code.
- Agents produce proposals and drafts; humans retain approval and publishing authority.
- Media binaries belong in object storage; Postgres stores metadata and relationships.
- The Agent worker is approved for real long-running tasks and lives under `sense-console/workers/` (`agent/`, later `video/`); it is a separate process, not part of the Web bundle. Monorepo and shared packages remain forbidden until a real requirement exists.
- Mandate and publishing gates must be enforced by the database (triggers/RPC); frontend checks are UX only, not gates.
- `sense-site/` is the approved sibling reader-site project; it must not share code via packages.
- Navigation has at most two levels, and the project uses one shadcn/ui Base UI component system.
- Once a shared UI component exists for a given interaction, reuse it instead of hand-rolling a parallel implementation — e.g. every category-hierarchy dropdown uses `sense-console/src/components/source-categories/category-select.tsx`; see `docs/conventions/frontend.md` for the running list.

Before handing off code, run typecheck, lint, tests, and build.
