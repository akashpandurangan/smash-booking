// A Supabase-like Postgres in-process (PGlite) for testing the REAL migrations (roles, auth.uid(), default grants).
// pgcrypto is not available in PGlite; gen_random_uuid() is built in, so that line is stripped when loading.
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIG = fileURLToPath(new URL('../../supabase/migrations', import.meta.url))
const STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb not null default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  -- Supabase grants everything on new objects to these roles by default; RLS/revokes do the real gating
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

`

export async function makeDb({ upTo = 99, files } = {}) {
  const db = new PGlite({ extensions: { btree_gist } })
  await db.exec(STUBS)
  const list = files || readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
  for (const f of list) {
    if (Number(f.slice(0, 4)) > upTo) continue
    try {
      await db.exec(readFileSync(join(MIG, f), 'utf8').replace('create extension if not exists pgcrypto;', ''))
    } catch (e) {
      e.message = `[${f}] ${e.message}`
      throw e
    }
  }
  return db
}

export async function seedUser(db, email, meta = {}) {
  const r = await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id', [email, JSON.stringify(meta)])
  return r.rows[0].id
}

/** Run a function as an authenticated user (RLS applies) / anon / service. */
export async function as(db, who, fn) {
  const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated'
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who === 'anon' || who === 'service' ? '' : who}', false); set role ${role};`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

export async function expectError(promise, re) {
  try {
    await promise
  } catch (e) {
    return re.test(e.message) ? true : `wrong error: ${e.message}`
  }
  return 'expected an error, got success'
}
