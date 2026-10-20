-- READ-ONLY checks. Run in the Supabase SQL editor AFTER migrations 0001 → 0006. Changes nothing.

-- 1) Every public table must have RLS on (expect 13 rows, all rls_on = true)
select c.relname as table, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;

-- 2) Double-booking guards (expect bookings_no_overlap, blocks_no_overlap, facilities_slug_key)
select conrelid::regclass as table, conname, contype
from pg_constraint
where connamespace = 'public'::regnamespace and conname in ('bookings_no_overlap', 'blocks_no_overlap', 'facilities_slug_key');

-- 3) Secret table must be unreadable by browser roles (expect both false)
select has_table_privilege('anon', 'public.facility_payment_config', 'select') as anon_can_read,
       has_table_privilege('authenticated', 'public.facility_payment_config', 'select') as signed_in_can_read;

-- 4) Functions the PUBLIC (not logged in) can call (expect exactly: get_busy_slots, get_facility_public, list_public_facilities)
select p.proname from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and has_function_privilege('anon', p.oid, 'execute') and p.proname not like 'gbt\_%' and p.proname not like '%\_dist'
order by 1;

-- 5) Nobody is a platform admin yet (expect 0) and the new-user trigger exists (expect 1)
select count(*) as platform_admins from public.platform_admins;
select count(*) as signup_trigger from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created';
