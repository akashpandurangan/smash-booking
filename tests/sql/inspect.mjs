// Read-only report of what migrations 0001→0006 create on an EMPTY database (in-process Postgres, no network).
import { makeDb } from './harness.mjs'
const db = await makeDb()
const q = async (s) => (await db.query(s)).rows
const tables = await q(`select c.relname t, c.relrowsecurity rls, (select count(*) from pg_policy p where p.polrelid=c.oid) pol,
  has_table_privilege('anon', c.oid, 'select') anon_sel, has_table_privilege('anon', c.oid, 'insert,update,delete') anon_w,
  has_table_privilege('authenticated', c.oid, 'insert,update,delete') auth_w
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`)
console.log('TABLES (rls | policies | anon can read | anon can write | signed-in can write directly)')
for (const t of tables) console.log(' ', t.t.padEnd(24), t.rls ? 'RLS' : 'NO-RLS', String(t.pol).padStart(2), t.anon_sel, t.anon_w, t.auth_w)
console.log('\nCONSTRAINTS of interest')
for (const c of await q(`select conrelid::regclass t, conname, pg_get_constraintdef(oid) d from pg_constraint where contype in ('x','u') and connamespace='public'::regnamespace order by 1,2`)) console.log(' ', String(c.t).padEnd(22), c.conname.padEnd(34), c.d.slice(0, 95))
const fns = await q(`select p.proname n, p.prosecdef def, has_function_privilege('anon', p.oid,'execute') anon_x, has_function_privilege('authenticated', p.oid,'execute') auth_x
  from pg_proc p where pronamespace='public'::regnamespace and p.prokind='f' order by 1`)
console.log('\nFUNCTIONS callable by anon:', fns.filter(f => f.anon_x).map(f => f.n).join(', '))
console.log('FUNCTIONS callable by signed-in (not anon):', fns.filter(f => f.auth_x && !f.anon_x).map(f => f.n).join(', '))
console.log('not callable by browsers:', fns.filter(f => !f.auth_x && !f.anon_x).map(f => f.n).join(', '))
console.log('NON-definer functions exposed:', fns.filter(f => (f.anon_x||f.auth_x) && !f.def).map(f => f.n).join(', ') || 'none')
console.log('\nROWS on fresh install:', JSON.stringify(Object.fromEntries(await Promise.all(['facilities','courts','orders','bookings','platform_admins','facility_members'].map(async t => [t, (await q(`select count(*)::int c from public.${t}`))[0].c])))))
console.log('trigger on auth.users:', (await q(`select tgname from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal`)).map(r=>r.tgname).join(',') || 'none')
