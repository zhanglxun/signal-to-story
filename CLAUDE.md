# Signal to Story project memory

Read @README.md before making architectural changes.

Also follow:

- @docs/architecture.md (single architecture entry; layers, target layout, call rules, R0–R5 order)
- @docs/README.md (doc index; module docs live in `docs/modules/`)

## Non-negotiable boundaries

- Application code is split by responsibility at the repo root: `sense-console/` (Web console only), `sense-site/` (reader site), `supabase/` (migrations, RLS, RPC, Edge Functions), `workers/` (`agent/` Node, `video/` Python), `testing/` (shared test infrastructure). There is no top-level `core/`: the agent loop lives in `workers/agent/loop` (decided 2026-11-18). See `docs/architecture.md`.
- User-facing branding is `Signal to Story`; `sense-console` is an internal directory name.
- The Console is a visual control plane, not a long-running execution engine.
- Ordinary CRUD may call Supabase directly only through publishable credentials and RLS.
- Never put `service_role`, database passwords, or provider secrets in browser code.
- Agents produce proposals and drafts; humans retain approval and publishing authority.
- Media binaries belong in object storage; Postgres stores metadata and relationships.
- Long-running tasks run only in `workers/` processes (outbound-only, claim jobs from the database); they are never part of a Web bundle.
- No npm workspaces or published packages. Shared code is plain source referenced by relative path / tsconfig alias (`supabase/functions/_shared/`); the repo root `package.json` serves the runtime side (workers, Supabase tests, `testing/`), and each Web app keeps its own.
- Dependency direction: `sense-console` never imports `workers`; `workers` never import `sense-console` (temporary exception until R2, which moves `sense-console/src/{harness,contracts}` into `workers/agent/loop`); `supabase/functions/*` import only `supabase/functions/_shared`; `sense-site` imports nothing from other projects.
- Mandate and publishing gates must be enforced by the database (triggers/RPC); frontend checks are UX only, not gates.
- `sense-site/` is the approved sibling reader-site project; it must not share code via packages.
- Navigation has at most two levels, and the project uses one shadcn/ui Base UI component system.
- Once a shared UI component exists for a given interaction, reuse it instead of hand-rolling a parallel implementation — e.g. every category-hierarchy dropdown uses `sense-console/src/components/source-categories/category-select.tsx`; see `docs/conventions/frontend.md` for the running list.

Before handing off code, run typecheck, lint, tests, and build for every touched project: root (`npm run typecheck|lint|test`, plus `npm run test:video-worker`), `npm --prefix sense-console run typecheck|lint|test|build`, `npm --prefix sense-site run typecheck|lint|test|build`.
