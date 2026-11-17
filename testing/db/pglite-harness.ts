/**
 * In-process Postgres (PGlite) test harness with a minimal Supabase shim.
 *
 * Usage (vitest, node environment):
 *
 *   // @vitest-environment node
 *   const db = await createSupabaseTestDb()          // shim + every migration applied
 *   const ids = await seedOrganization(db, { members: [{ role: "owner" }] })
 *   await db.asUser(ids.members.owner, (tx) => tx.query("select * from public.content_projects"))
 *   await db.asServiceRole((tx) => tx.query("select public.claim_agent_job($1,$2,$3)", [...]))
 *   await db.close()
 *
 * Each as*() call runs inside one transaction with `set local role` and
 * `request.jwt.claims`, exactly like PostgREST does per request. Throwing inside
 * the callback rolls the transaction back.
 *
 * Limitations: PGlite is single-connection, so concurrent transactions are
 * serialized. `FOR UPDATE SKIP LOCKED` semantics are exercised logically (no
 * double claim), not under real parallel lock contention.
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite, type Transaction } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, "../..")
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase/migrations")
export const SQL_TESTS_DIR = path.join(REPO_ROOT, "supabase/tests")

export type DbTx = Transaction | PGlite

export interface CreateSupabaseTestDbOptions {
  /** Defaults to supabase/migrations. */
  migrationsDir?: string
  /** Only apply migrations whose file name sorts <= this value (e.g. to test an upgrade). */
  upTo?: string
  /** Extra SQL executed as postgres after migrations (fixtures). */
  afterMigrations?: string
}

export interface SupabaseTestDb {
  db: PGlite
  appliedMigrations: string[]
  /** Run as superuser `postgres` (like the SQL editor / migrations). */
  asPostgres<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
  /** Run as role `authenticated` with JWT sub = userId. */
  asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>, extraClaims?: Record<string, unknown>): Promise<T>
  /** Run as role `service_role` (bypasses RLS, no auth.uid()). */
  asServiceRole<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
  /** Run as role `anon`. */
  asAnon<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function listMigrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
}

export function readSupabaseShimSql(): string {
  return readFileSync(path.join(here, "supabase-shim.sql"), "utf8")
}

async function withRole<T>(
  db: PGlite,
  role: "authenticated" | "service_role" | "anon" | null,
  claims: Record<string, unknown> | null,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : ""])
    await tx.query("select set_config('request.jwt.claim.sub', '', true)")
    if (role) await tx.exec(`set local role ${role}`)
    return fn(tx)
  })
}

export async function createSupabaseTestDb(options: CreateSupabaseTestDbOptions = {}): Promise<SupabaseTestDb> {
  const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm } })
  await db.exec(readSupabaseShimSql())
  const dir = options.migrationsDir ?? MIGRATIONS_DIR
  const applied: string[] = []
  for (const file of listMigrationFiles(dir)) {
    if (options.upTo && file > options.upTo) break
    try {
      await db.exec(readFileSync(path.join(dir, file), "utf8"))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Migration ${file} failed in PGlite: ${message}`, { cause: error })
    }
    applied.push(file)
  }
  if (options.afterMigrations) await db.exec(options.afterMigrations)

  return {
    db,
    appliedMigrations: applied,
    asPostgres: (fn) => withRole(db, null, null, fn),
    asUser: (userId, fn, extraClaims) =>
      withRole(db, "authenticated", { sub: userId, role: "authenticated", aud: "authenticated", ...extraClaims }, fn),
    asServiceRole: (fn) => withRole(db, "service_role", { role: "service_role" }, fn),
    asAnon: (fn) => withRole(db, "anon", { role: "anon" }, fn),
    close: () => db.close(),
  }
}

/** Run a supabase/tests/*.sql acceptance script (begin ... rollback) and return the final rows. */
export async function runSqlAcceptanceScript(testDb: SupabaseTestDb, fileName: string) {
  const sql = readFileSync(path.join(SQL_TESTS_DIR, fileName), "utf8")
  const results = await testDb.db.exec(sql)
  return results.at(-1)?.rows ?? []
}

export interface SeedMemberSpec {
  role: string
  permissions?: string[]
}

export interface SeededOrganization {
  organizationId: string
  /** role -> user id */
  members: Record<string, string>
}

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ["content.view", "content.manage", "content.review", "content.publish", "agent.dispatch", "account.manage"],
  admin: ["content.view", "content.manage", "content.review", "content.publish", "agent.dispatch"],
  member: ["content.view", "content.manage", "agent.dispatch"],
  viewer: ["content.view"],
}

/** Create an organization with roles and one user per requested role (as postgres). */
export async function seedOrganization(
  testDb: SupabaseTestDb,
  spec: { slug?: string; members: SeedMemberSpec[] }
): Promise<SeededOrganization> {
  return testDb.asPostgres(async (tx) => {
    const slug = spec.slug ?? `org-${crypto.randomUUID().slice(0, 8)}`
    const org = await tx.query<{ id: string }>(
      "insert into public.organizations(slug,name) values($1,$1) returning id",
      [slug]
    )
    const organizationId = org.rows[0].id
    const members: Record<string, string> = {}
    for (const member of spec.members) {
      const permissions = member.permissions ?? DEFAULT_ROLE_PERMISSIONS[member.role] ?? ["content.view"]
      await tx.query(
        `insert into public.organization_roles(organization_id,role_key,name,description,permissions,assignment_permission)
         values($1,$2,$2,'Test role',$3,'account.manage')
         on conflict (organization_id, role_key) do update set permissions = excluded.permissions`,
        [organizationId, member.role, permissions]
      )
      const user = await tx.query<{ id: string }>(
        "insert into auth.users(email) values($1) returning id",
        [`${member.role}-${crypto.randomUUID().slice(0, 8)}@example.invalid`]
      )
      const userId = user.rows[0].id
      await tx.query("insert into public.profiles(user_id,email,display_name) select id,email,'Test '||$2 from auth.users where id=$1", [
        userId,
        member.role,
      ])
      await tx.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,$3)", [
        organizationId,
        userId,
        member.role,
      ])
      members[member.role] = userId
    }
    return { organizationId, members }
  })
}
