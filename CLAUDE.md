# Signal to Story project memory

Read @README.md before making architectural changes.

Also follow:

- @docs-site/spec/Signal-to-Story总体架构-SPEC.md
- @docs-site/spec/内容系统分层与Obsidian单向同步-SPEC.md
- @docs-site/plan/frame-work.md

## Non-negotiable boundaries

- All current application code belongs under `sense-console/`.
- User-facing branding is `Signal to Story`; `sense-console` is an internal directory name.
- The Console is a visual control plane, not a long-running execution engine.
- Ordinary CRUD may call Supabase directly only through publishable credentials and RLS.
- Never put `service_role`, database passwords, or provider secrets in browser code.
- Agents produce proposals and drafts; humans retain approval and publishing authority.
- Media binaries belong in object storage; Postgres stores metadata and relationships.
- Do not introduce a Worker, monorepo, or shared packages before a real requirement exists.
- Navigation has at most two levels, and the project uses one shadcn/ui Base UI component system.

Before handing off code, run typecheck, lint, tests, and build.
