import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");

// Stand-ins for the parts of Supabase that PGlite does not have.
const SUPABASE_STUBS = `
do $r$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $r$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists extensions;
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create table if not exists cron.job_run_details (runid bigserial primary key, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
  language sql as $f$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $f$;
create or replace function cron.unschedule(job_id bigint) returns boolean
  language sql as $f$ delete from cron.job where jobid = job_id returning true $f$;
create schema if not exists net;
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 1000)
  returns bigint language sql as $f$ select 1::bigint $f$;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);
`;

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function newDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  return db;
}

export async function runMigrations(db: PGlite): Promise<void> {
  for (const file of migrationFiles()) {
    let sql = readFileSync(join(migrationsDir, file), "utf8");
    // PGlite has no pg_cron / pg_net; the stubs above stand in for them.
    sql = sql.replace(/^create extension .*;$/gim, "");
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }
}

export async function addVaultSecrets(db: PGlite) {
  await db.exec(
    "insert into vault.decrypted_secrets values ('nudge_app_url','https://example.test'),('nudge_cron_secret','x')",
  );
}

let template: Promise<Blob | File> | null = null;

/** A fresh database with every migration applied. Built once, then copied for each test. */
export async function readyDb(): Promise<PGlite> {
  if (!template) {
    template = (async () => {
      const base = await newDb();
      await addVaultSecrets(base);
      await runMigrations(base);
      const dump = await base.dumpDataDir("none");
      await base.close();
      return dump;
    })();
  }
  return new PGlite({ loadDataDir: await template });
}

export async function addUser(db: PGlite, email = "a@example.test"): Promise<string> {
  const r = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  return r.rows[0].id;
}

/** Runs a function as a signed-in user (RLS applies), then switches back. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role anon;");
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

export async function asServer<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role;");
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

export const rlsCheckSql = () => readFileSync(join(root, "supabase", "tests", "rls_check.sql"), "utf8");

/** Supabase's service role can use every table and skips row level security; PGlite's stand-in needs telling. */
export async function serverLikeSupabase(db: PGlite) {
  await db.exec("grant all on all tables in schema public to service_role; alter role service_role bypassrls;");
}
