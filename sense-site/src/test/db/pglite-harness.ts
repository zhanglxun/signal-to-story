// Minimal in-process Postgres (PGlite) with a Supabase-like shim: the anon /
// authenticated / service_role roles, auth.uid()/auth.jwt(), auth.users and a
// tiny storage schema. Every migration in supabase/migrations is
// applied in filename order, so RLS and grants are exercised for real.
//
// This harness only lives inside sense-site tests and never connects to a
// remote database. If sense-console later ships its own shared PGlite harness,
// prefer that one and delete this file.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite, type Transaction } from "@electric-sql/pglite"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto"

const here = path.dirname(fileURLToPath(import.meta.url))
export const migrationsDir = path.resolve(
  here,
  "../../../../supabase/migrations"
)

const supabaseShim = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema if not exists extensions;
create schema auth;
create schema storage;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub'), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role')
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant all on storage.objects, storage.buckets to service_role;

-- Supabase grants broad default privileges on public; migrations must revoke explicitly.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`

export function listMigrations() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
}

export async function createMigratedDatabase() {
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } })
  await db.exec(supabaseShim)
  for (const file of listMigrations()) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8")
    try {
      await db.exec(sql)
    } catch (error) {
      throw new Error(
        `Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
  }
  return db
}

export type Identity =
  | { role: "anon" }
  | {
      role: "authenticated"
      userId: string
      isAnonymous?: boolean
    }

/**
 * Runs `fn` inside a transaction impersonating a PostgREST request. The
 * transaction is always rolled back unless `commit` is set, so callers that
 * expect a failure can keep using the same database afterwards.
 */
export async function asIdentity<T>(
  db: PGlite,
  identity: Identity,
  fn: (tx: Transaction) => Promise<T>,
  { commit = false }: { commit?: boolean } = {}
): Promise<T> {
  return db.transaction(async (tx) => {
    const claims =
      identity.role === "anon"
        ? { role: "anon" }
        : {
            role: "authenticated",
            sub: identity.userId,
            is_anonymous: identity.isAnonymous ?? false,
          }
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ])
    await tx.query(
      "select set_config('request.jwt.claim.sub', $1, true)",
      [identity.role === "anon" ? "" : identity.userId]
    )
    await tx.exec(`set local role ${identity.role}`)
    const result = await fn(tx)
    if (!commit) await tx.rollback()
    return result
  })
}

/** Returns the error message produced by `fn`, or null if it succeeded. */
export async function expectDenied(
  db: PGlite,
  identity: Identity,
  fn: (tx: Transaction) => Promise<unknown>
): Promise<string | null> {
  try {
    await asIdentity(db, identity, fn)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
