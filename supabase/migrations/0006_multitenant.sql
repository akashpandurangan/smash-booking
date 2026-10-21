-- =====================================================================
-- 0006: MULTI-TENANT PLATFORM
--
--  * `facilities` (one per owner/venue, unique URL-safe `slug` = the subdomain)
--  * `facility_members` (who may manage which facility)  — NOT a global "owner" flag
--  * `platform_admins` (explicit allow-list, only ever inserted by SQL)
--  * every tenant table gets `facility_id`; all RPCs and RLS are facility-scoped
--  * per-facility payment credentials live in a table no browser role can read
--
-- Your existing single facility (facility_settings, id = 1) is migrated into a
-- facility with slug 'smash-booking'; former global owners become its owner.
-- Run after 0005. Safe to read top-to-bottom; one transaction in the SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- platform level
-- ---------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (key, value) values
  ('require_facility_approval', 'false'::jsonb),   -- true: new facilities wait for a platform admin
  ('max_facilities_per_owner',  '1'::jsonb),
  ('max_courts_per_facility',   '6'::jsonb);

create table public.reserved_slugs (slug text primary key);
insert into public.reserved_slugs (slug) values
  ('www'), ('app'), ('api'), ('admin'), ('owner'), ('owners'), ('platform'), ('mail'), ('smtp'), ('ftp'),
  ('dashboard'), ('auth'), ('login'), ('register'), ('signup'), ('support'), ('help'), ('status'), ('blog'),
  ('docs'), ('static'), ('assets'), ('cdn'), ('dev'), ('test'), ('staging'), ('smashbooking'), ('smash'),
  ('booking'), ('bookings'), ('localhost'), ('vercel'), ('supabase'), ('root'), ('null'), ('undefined'), ('f');

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- facilities (tenants)
-- ---------------------------------------------------------------------
create table public.facilities (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name                  text not null check (char_length(name) between 2 and 80),
  tagline               text not null default 'Your Court. Your Game.',
  logo_url              text check (logo_url is null or logo_url ~ '^https://'),
  address               text not null default '',
  city                  text not null default '',
  contact_phone         text,
  contact_email         text,
  status                text not null default 'draft' check (status in ('draft','pending','active','suspended')),
  suspended_reason      text,
  plan                  text not null default 'free',
  max_courts            int  not null default 6 check (max_courts between 1 and 50),
  opening_time          time not null default '06:00',
  closing_time          time not null default '22:00',
  slot_minutes          int  not null default 30 check (slot_minutes between 15 and 120),
  price_per_slot        numeric(10,2) not null default 150 check (price_per_slot >= 0),
  max_slots_per_booking int  not null default 8 check (max_slots_per_booking between 1 and 24),
  max_unpaid_holds      int  not null default 2 check (max_unpaid_holds between 1 and 10),
  hold_minutes          int  not null default 15 check (hold_minutes between 5 and 1440),
  advance_booking_days  int  not null default 14 check (advance_booking_days between 1 and 14),
  timezone              text not null default 'Asia/Kolkata',
  cancellation_policy   text not null default 'Contact the facility to cancel a confirmed booking.',
  available_durations   int[] not null default '{1,2,3,4}' check (available_durations <@ array[1,2,3,4] and cardinality(available_durations) >= 1),
  closed_weekdays       smallint[] not null default '{}' check (closed_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),  -- 0 = Sunday
  holidays              date[] not null default '{}',
  allow_demo_payments   boolean not null default false,
  payment_mode          text not null default 'none' check (payment_mode in ('none','razorpay')),
  razorpay_key_id       text check (razorpay_key_id is null or razorpay_key_id ~ '^rzp_(test|live)_[A-Za-z0-9]+$'),
  created_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint facility_hours_valid check (opening_time < closing_time)
);
create index facilities_status_idx on public.facilities (status);

create table public.facility_members (
  facility_id uuid not null references public.facilities(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner', 'staff')),
  created_at  timestamptz not null default now(),
  primary key (facility_id, user_id)
);
create index facility_members_user_idx on public.facility_members (user_id);

-- Payment credentials: written/read ONLY by Edge Functions (service role). No policies, no grants.
create table public.facility_payment_config (
  facility_id        uuid primary key references public.facilities(id) on delete cascade,
  razorpay_key_id    text not null,
  razorpay_key_secret text not null,
  webhook_secret     text,
  updated_at         timestamptz not null default now()
);
alter table public.facility_payment_config enable row level security;
revoke all on public.facility_payment_config from anon, authenticated;

create or replace function public.is_facility_member(p_fid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.facility_members where facility_id = p_fid and user_id = auth.uid());
$$;

create or replace function public._require_member(p_fid uuid)
returns void language plpgsql stable as $$
begin
  if p_fid is null or not public.is_facility_member(p_fid) then raise exception 'forbidden'; end if;
end $$;

-- ---------------------------------------------------------------------
-- migrate the existing single facility
-- ---------------------------------------------------------------------
insert into public.facilities (
  slug, name, tagline, address, contact_phone, contact_email, status, opening_time, closing_time, slot_minutes,
  price_per_slot, max_slots_per_booking, max_unpaid_holds, hold_minutes, advance_booking_days, timezone,
  cancellation_policy, allow_demo_payments
)
select 'smash-booking', name, tagline, address, contact_phone, contact_email, 'active', opening_time, closing_time, slot_minutes,
       price_per_slot, greatest(max_slots_per_booking, 8), max_unpaid_holds, hold_minutes, least(advance_booking_days, 14), timezone,
       cancellation_policy, allow_demo_payments
  from public.facility_settings
 where id = 1
   -- a fresh install has no courts/orders yet: don't create an empty public tenant
   and (exists (select 1 from public.courts) or exists (select 1 from public.orders));

insert into public.facility_members (facility_id, user_id, role)
select (select id from public.facilities where slug = 'smash-booking'), p.id, 'owner'
  from public.profiles p
 where p.role = 'owner' and exists (select 1 from public.facilities where slug = 'smash-booking');

-- ---------------------------------------------------------------------
-- facility_id everywhere
-- ---------------------------------------------------------------------
alter table public.courts add column facility_id uuid references public.facilities(id) on delete cascade;
alter table public.courts add column image_url text check (image_url is null or image_url ~ '^https://');
update public.courts set facility_id = (select id from public.facilities where slug = 'smash-booking');
alter table public.courts alter column facility_id set not null;
alter table public.courts drop constraint courts_number_key;
alter table public.courts add constraint courts_facility_number_key unique (facility_id, number);
create index courts_facility_idx on public.courts (facility_id);

alter table public.orders add column facility_id uuid references public.facilities(id);
update public.orders set facility_id = (select id from public.facilities where slug = 'smash-booking');
alter table public.orders alter column facility_id set not null;
create index orders_facility_idx on public.orders (facility_id, booking_date);

alter table public.bookings add column facility_id uuid references public.facilities(id);
update public.bookings b set facility_id = c.facility_id from public.courts c where c.id = b.court_id;
alter table public.bookings alter column facility_id set not null;
create index bookings_facility_idx on public.bookings (facility_id, booking_date);

alter table public.blocked_slots add column facility_id uuid references public.facilities(id) on delete cascade;
update public.blocked_slots k set facility_id = c.facility_id from public.courts c where c.id = k.court_id;
alter table public.blocked_slots alter column facility_id set not null;
create index blocked_slots_facility_idx on public.blocked_slots (facility_id, block_date);

alter table public.audit_events add column facility_id uuid references public.facilities(id) on delete cascade;
update public.audit_events set facility_id = (select id from public.facilities where slug = 'smash-booking');
create index audit_events_facility_idx on public.audit_events (facility_id, created_at desc);

-- ---------------------------------------------------------------------
-- remove the single-tenant plumbing
-- ---------------------------------------------------------------------
drop policy if exists profiles_select  on public.profiles;
drop policy if exists courts_read      on public.courts;
drop policy if exists courts_write     on public.courts;
drop policy if exists bookings_select  on public.bookings;
drop policy if exists payments_select  on public.payment_submissions;
drop policy if exists blocks_select    on public.blocked_slots;
drop policy if exists audit_select     on public.audit_events;
drop policy if exists orders_select    on public.orders;

drop table public.facility_settings cascade;
drop function if exists public._audit_settings();

drop function if exists public.get_busy_slots(date);
drop function if exists public.create_order(uuid[], date, jsonb, text, text);
drop function if exists public.admin_create_order(uuid[], date, jsonb, text, text, text, boolean, text);
drop function if exists public._create_order(uuid, uuid[], date, jsonb, text, text, text, text, boolean, text);
drop function if exists public.admin_create_block(uuid, date, time, time, text);
drop function if exists public.admin_remove_block(uuid);
drop function if exists public.admin_set_order_status(uuid, text, text);
drop function if exists public.admin_mark_refunded(uuid, text);
drop function if exists public.demo_pay_order(uuid);
drop function if exists public._insert_order_rows(public.orders, uuid[], text);
drop function if exists public._log_event(text, text, uuid, jsonb);
drop function if exists public._facility_now();
drop function if exists public._require_owner();
drop function if exists public.is_owner();

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------
create or replace function public._facility_now(p_fid uuid)
returns timestamp language sql stable security definer set search_path = public as $$
  select now() at time zone (select timezone from public.facilities where id = p_fid);
$$;

create or replace function public._log_event(p_fid uuid, p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (facility_id, actor_id, actor_email, action, entity_type, entity_id, details)
  values (p_fid, auth.uid(), (select email from public.profiles where id = auth.uid()),
          p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;

create or replace function public._platform_setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.platform_settings where key = p_key;
$$;

-- ---------------------------------------------------------------------
-- slugs: format, reservation, availability (the DB is the authority)
-- ---------------------------------------------------------------------
create or replace function public.check_slugs(p_slugs text[])
returns table (slug text, available boolean, reason text)
language sql stable security definer set search_path = public as $$
  select s,
         (s ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and s !~ '--'
            and not exists (select 1 from public.reserved_slugs r where r.slug = s)
            and not exists (select 1 from public.facilities f where f.slug = s)),
         case when s !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' or s ~ '--' then 'invalid'
              when exists (select 1 from public.reserved_slugs r where r.slug = s) then 'reserved'
              when exists (select 1 from public.facilities f where f.slug = s) then 'taken'
              else null end
    from (select distinct lower(btrim(x)) as s from unnest(coalesce(p_slugs, '{}')) x limit 12) q;
$$;

-- ---------------------------------------------------------------------
-- tenant resolution (public). Facility ids/owners are never taken from the browser.
-- ---------------------------------------------------------------------
create or replace function public.get_facility_public(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f public.facilities;
  privileged boolean;
begin
  select * into f from public.facilities where slug = lower(btrim(coalesce(p_slug, '')));
  if f.id is null then return jsonb_build_object('state', 'not_found'); end if;
  privileged := public.is_facility_member(f.id) or public.is_platform_admin();
  if f.status <> 'active' and not privileged then
    return jsonb_build_object('state', case when f.status = 'suspended' then 'suspended' else 'not_live' end);
  end if;
  return jsonb_build_object(
    'state', case when f.status = 'active' then 'live' else 'preview' end,
    'facility', jsonb_build_object(
      'id', f.id, 'slug', f.slug, 'name', f.name, 'tagline', f.tagline, 'logo_url', f.logo_url,
      'address', f.address, 'city', f.city, 'contact_phone', f.contact_phone, 'contact_email', f.contact_email,
      'status', f.status, 'opening_time', f.opening_time, 'closing_time', f.closing_time, 'slot_minutes', f.slot_minutes,
      'price_per_slot', f.price_per_slot, 'max_slots_per_booking', f.max_slots_per_booking,
      'max_unpaid_holds', f.max_unpaid_holds, 'hold_minutes', f.hold_minutes, 'advance_booking_days', f.advance_booking_days,
      'timezone', f.timezone, 'cancellation_policy', f.cancellation_policy, 'available_durations', f.available_durations,
      'closed_weekdays', f.closed_weekdays, 'holidays', f.holidays, 'allow_demo_payments', f.allow_demo_payments,
      'payment_mode', f.payment_mode, 'razorpay_key_id', f.razorpay_key_id),
    'courts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'name', c.name,
                                                             'image_url', c.image_url, 'is_active', c.is_active) order by c.number)
                          from public.courts c where c.facility_id = f.id), '[]'::jsonb));
end $$;

create or replace function public.list_public_facilities()
returns table (slug text, name text, city text, logo_url text, tagline text)
language sql stable security definer set search_path = public as $$
  select f.slug, f.name, f.city, f.logo_url, f.tagline from public.facilities f where f.status = 'active' order by f.name;
$$;

-- ---------------------------------------------------------------------
-- facility creation (setup wizard) and owner edits
-- ---------------------------------------------------------------------
create or replace function public._json_int_array(p jsonb) returns int[]
language sql immutable as $$ select coalesce(array(select (x)::int from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) x), '{}') $$;

create or replace function public.create_facility(p jsonb)
returns public.facilities
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_slug text := lower(btrim(coalesce(p ->> 'slug', '')));
  v_phone text := regexp_replace(coalesce(p ->> 'contact_phone', ''), '[^0-9]', '', 'g');
  v_open time := (p ->> 'opening_time')::time;
  v_close time := (p ->> 'closing_time')::time;
  v_durs int[] := public._json_int_array(p -> 'available_durations');
  v_hourly numeric := (p ->> 'price_per_hour')::numeric;
  v_courts jsonb := coalesce(p -> 'courts', '[]'::jsonb);
  v_max_courts int := coalesce((public._platform_setting('max_courts_per_facility'))::text::int, 6);
  v_limit int := coalesce((public._platform_setting('max_facilities_per_owner'))::text::int, 1);
  v_status text;
  f public.facilities;
  c jsonb;
  i int := 0;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if (select count(*) from public.facility_members where user_id = uid and role = 'owner') >= v_limit then
    raise exception 'facility_limit_reached';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'invalid_facility_name'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' or v_slug ~ '--' then raise exception 'invalid_slug'; end if;
  if exists (select 1 from public.reserved_slugs where slug = v_slug) then raise exception 'slug_reserved'; end if;
  if exists (select 1 from public.facilities where slug = v_slug) then raise exception 'slug_taken'; end if;
  if v_phone !~ '^[0-9]{10,15}$' then raise exception 'invalid_phone'; end if;
  if v_open is null or v_close is null or v_open >= v_close then raise exception 'invalid_hours'; end if;
  if cardinality(v_durs) = 0 or not (v_durs <@ array[1,2,3,4]) then raise exception 'invalid_durations'; end if;
  if v_hourly is null or v_hourly < 0 then raise exception 'invalid_price'; end if;
  if jsonb_typeof(v_courts) <> 'array' or jsonb_array_length(v_courts) < 1 then raise exception 'invalid_courts'; end if;
  if jsonb_array_length(v_courts) > v_max_courts then raise exception 'court_limit_reached'; end if;
  if char_length(btrim(coalesce(p ->> 'address', ''))) < 3 or char_length(btrim(coalesce(p ->> 'city', ''))) < 2 then
    raise exception 'invalid_address';
  end if;

  v_status := case when coalesce((public._platform_setting('require_facility_approval'))::text::boolean, false) then 'pending' else 'active' end;

  begin
    insert into public.facilities (
      slug, name, tagline, logo_url, address, city, contact_phone, contact_email, status, max_courts,
      opening_time, closing_time, price_per_slot, max_slots_per_booking, available_durations,
      closed_weekdays, holidays, cancellation_policy, created_by
    ) values (
      v_slug, v_name, coalesce(nullif(btrim(p ->> 'tagline'), ''), 'Your Court. Your Game.'),
      nullif(btrim(p ->> 'logo_url'), ''), btrim(p ->> 'address'), btrim(p ->> 'city'), v_phone,
      nullif(btrim(coalesce(p ->> 'contact_email', '')), ''), v_status, v_max_courts,
      v_open, v_close, round(v_hourly / 2, 2), greatest((select max(d) from unnest(v_durs) d) * 2, 2), v_durs,
      coalesce(array(select (x)::smallint from jsonb_array_elements_text(coalesce(p -> 'closed_weekdays', '[]'::jsonb)) x), '{}'),
      coalesce(array(select (x)::date from jsonb_array_elements_text(coalesce(p -> 'holidays', '[]'::jsonb)) x), '{}'),
      coalesce(nullif(btrim(p ->> 'cancellation_policy'), ''), 'Contact the facility to cancel a confirmed booking.'),
      uid
    ) returning * into f;
  exception when unique_violation then
    raise exception 'slug_taken';
  end;

  insert into public.facility_members (facility_id, user_id, role) values (f.id, uid, 'owner');

  for c in select * from jsonb_array_elements(v_courts) loop
    i := i + 1;
    insert into public.courts (facility_id, number, name, image_url)
    values (f.id, i, coalesce(nullif(btrim(c ->> 'name'), ''), 'Court ' || i), nullif(btrim(c ->> 'image_url'), ''));
  end loop;

  perform public._log_event(f.id, 'facility_created', 'facility', f.id, jsonb_build_object('slug', f.slug, 'status', f.status));
  return f;
end $$;

create or replace function public.update_facility(p_fid uuid, p jsonb)
returns public.facilities
language plpgsql security definer set search_path = public as $$
declare
  f public.facilities;
  v_durs int[];
  v_phone text;
begin
  perform public._require_member(p_fid);
  select * into f from public.facilities where id = p_fid for update;

  if p ? 'name' and char_length(btrim(p ->> 'name')) not between 2 and 80 then raise exception 'invalid_facility_name'; end if;
  if p ? 'contact_phone' and nullif(btrim(p ->> 'contact_phone'), '') is not null then
    v_phone := regexp_replace(p ->> 'contact_phone', '[^0-9]', '', 'g');
    if v_phone !~ '^[0-9]{10,15}$' then raise exception 'invalid_phone'; end if;
  end if;
  if p ? 'available_durations' then
    v_durs := public._json_int_array(p -> 'available_durations');
    if cardinality(v_durs) = 0 or not (v_durs <@ array[1,2,3,4]) then raise exception 'invalid_durations'; end if;
  end if;
  if p ? 'price_per_hour' and (p ->> 'price_per_hour')::numeric < 0 then raise exception 'invalid_price'; end if;

  -- NOTE: slug, status, plan and max_courts are intentionally NOT editable here.
  update public.facilities set
    name = coalesce(btrim(p ->> 'name'), name),
    tagline = coalesce(nullif(btrim(p ->> 'tagline'), ''), tagline),
    logo_url = case when p ? 'logo_url' then nullif(btrim(p ->> 'logo_url'), '') else logo_url end,
    address = coalesce(btrim(p ->> 'address'), address),
    city = coalesce(btrim(p ->> 'city'), city),
    contact_phone = case when p ? 'contact_phone' then nullif(v_phone, '') else contact_phone end,
    contact_email = case when p ? 'contact_email' then nullif(btrim(p ->> 'contact_email'), '') else contact_email end,
    opening_time = coalesce((p ->> 'opening_time')::time, opening_time),
    closing_time = coalesce((p ->> 'closing_time')::time, closing_time),
    price_per_slot = case when p ? 'price_per_hour' then round((p ->> 'price_per_hour')::numeric / 2, 2) else price_per_slot end,
    available_durations = coalesce(v_durs, available_durations),
    max_slots_per_booking = case when v_durs is not null then greatest((select max(d) from unnest(v_durs) d) * 2, 2) else max_slots_per_booking end,
    max_unpaid_holds = coalesce((p ->> 'max_unpaid_holds')::int, max_unpaid_holds),
    hold_minutes = coalesce((p ->> 'hold_minutes')::int, hold_minutes),
    advance_booking_days = coalesce((p ->> 'advance_booking_days')::int, advance_booking_days),
    cancellation_policy = coalesce(nullif(btrim(p ->> 'cancellation_policy'), ''), cancellation_policy),
    closed_weekdays = case when p ? 'closed_weekdays'
        then coalesce(array(select (x)::smallint from jsonb_array_elements_text(p -> 'closed_weekdays') x), '{}') else closed_weekdays end,
    holidays = case when p ? 'holidays'
        then coalesce(array(select (x)::date from jsonb_array_elements_text(p -> 'holidays') x), '{}') else holidays end,
    allow_demo_payments = coalesce((p ->> 'allow_demo_payments')::boolean, allow_demo_payments),
    updated_at = now()
  where id = p_fid returning * into f;

  perform public._log_event(p_fid, 'facility_updated', 'facility', p_fid,
                            jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return f;
end $$;

-- courts: owners manage them directly (RLS), limited by plan
create or replace function public._courts_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare maxc int; cnt int;
begin
  select max_courts into maxc from public.facilities where id = new.facility_id;
  select count(*) into cnt from public.courts where facility_id = new.facility_id;
  if cnt >= coalesce(maxc, 0) then raise exception 'court_limit_reached'; end if;
  if new.number is null then
    select coalesce(max(number), 0) + 1 into new.number from public.courts where facility_id = new.facility_id;
  end if;
  if new.name is null or btrim(new.name) = '' then new.name := 'Court ' || new.number; end if;
  return new;
end $$;
create trigger courts_before_insert before insert on public.courts
  for each row execute function public._courts_before_insert();

-- ---------------------------------------------------------------------
-- bookings (facility-scoped rewrite of 0004/0005 logic)
-- ---------------------------------------------------------------------
create or replace function public._insert_order_rows(o public.orders, p_court_ids uuid[], p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  seg record;
  nrows int := greatest(o.court_count * jsonb_array_length(o.segments), 1);
begin
  foreach cid in array p_court_ids loop   -- sorted ids: stable lock order, no deadlocks
    for seg in select (x."start")::time as seg_s, (x."end")::time as seg_e
                 from jsonb_to_recordset(o.segments) as x("start" text, "end" text) order by 1 loop
      insert into public.bookings (
        facility_id, reference, user_id, court_id, booking_date, start_time, end_time,
        customer_name, customer_phone, customer_email, total_amount, advance_amount,
        status, expires_at, created_by_admin, admin_note, confirmed_at, order_id
      ) values (
        o.facility_id, o.reference, o.user_id, cid, o.booking_date, seg.seg_s, seg.seg_e,
        o.customer_name, o.customer_phone, o.customer_email,
        o.total_amount / nrows, o.total_amount / nrows,
        p_status, case when p_status = 'pending_payment' then o.expires_at end,
        o.created_by_admin, o.admin_note, case when p_status = 'confirmed' then now() end, o.id
      );
    end loop;
  end loop;
end $$;

create or replace function public._create_order(
  p_facility uuid, p_user uuid, p_court_ids uuid[], p_date date, p_segments jsonb,
  p_name text, p_phone text, p_email text, p_status text, p_by_admin boolean, p_note text
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  f public.facilities;
  ids uuid[];
  n int;
  seg record;
  prev_end time := null;
  mins numeric;
  slots int := 0;
  first_start time;
  last_end time;
  clean jsonb := '[]'::jsonb;
  o public.orders;
begin
  select * into f from public.facilities where id = p_facility;
  if f.id is null then raise exception 'facility_not_found'; end if;
  if not p_by_admin and f.status <> 'active' then raise exception 'facility_not_active'; end if;

  select array_agg(distinct x order by x) into ids from unnest(coalesce(p_court_ids, '{}')) x;
  n := coalesce(array_length(ids, 1), 0);
  if n < 1 then raise exception 'no_courts_selected'; end if;
  -- every court must belong to THIS facility and be active
  if n <> (select count(*) from public.courts where id = any(ids) and is_active and facility_id = p_facility) then
    raise exception 'court_unavailable';
  end if;

  if p_segments is null or jsonb_typeof(p_segments) <> 'array' or jsonb_array_length(p_segments) = 0 then
    raise exception 'invalid_slot';
  end if;
  if not p_by_admin and (extract(dow from p_date)::smallint = any(f.closed_weekdays) or p_date = any(f.holidays)) then
    raise exception 'facility_closed_that_day';
  end if;

  for seg in select (x."start")::time as seg_s, (x."end")::time as seg_e
               from jsonb_to_recordset(p_segments) as x("start" text, "end" text) order by 1 loop
    if seg.seg_e <= seg.seg_s then raise exception 'invalid_time_range'; end if;
    if seg.seg_s < f.opening_time or seg.seg_e > f.closing_time then raise exception 'outside_operating_hours'; end if;
    mins := extract(epoch from (seg.seg_e - seg.seg_s)) / 60;
    if mod(mins, f.slot_minutes) <> 0
       or mod(extract(epoch from (seg.seg_s - f.opening_time)) / 60, f.slot_minutes) <> 0 then
      raise exception 'invalid_slot';
    end if;
    if prev_end is not null and seg.seg_s < prev_end then raise exception 'invalid_slot'; end if;
    prev_end := seg.seg_e;
    slots := slots + (mins / f.slot_minutes)::int;
    first_start := coalesce(first_start, seg.seg_s);
    last_end := seg.seg_e;
    clean := clean || jsonb_build_object('start', to_char(seg.seg_s, 'HH24:MI'), 'end', to_char(seg.seg_e, 'HH24:MI'));
    if not p_by_admin and (p_date + seg.seg_s) <= public._facility_now(p_facility) then raise exception 'slot_in_past'; end if;
    if exists (select 1 from public.blocked_slots
                where court_id = any(ids)
                  and slot_range && tsrange(p_date + seg.seg_s, p_date + seg.seg_e, '[)')) then
      raise exception 'slot_blocked';
    end if;
  end loop;
  if not p_by_admin then
    -- customers may only book whole hours from the durations the owner offers
    if mod(slots * f.slot_minutes, 60) <> 0 or not ((slots * f.slot_minutes / 60) = any(f.available_durations)) then
      raise exception 'invalid_duration';
    end if;
  end if;
  if slots > f.max_slots_per_booking then raise exception 'too_many_slots'; end if;
  if not p_by_admin then
    if p_date > public._facility_now(p_facility)::date + (f.advance_booking_days - 1) then raise exception 'too_far_ahead'; end if;
  end if;

  perform public.expire_stale_bookings();

  insert into public.orders (
    facility_id, reference, user_id, booking_date, start_time, end_time, segments, customer_name, customer_phone, customer_email,
    court_count, total_amount, status, payment_status, payment_method, expires_at, confirmed_at,
    created_by_admin, admin_note
  ) values (
    p_facility, public._new_reference(), p_user, p_date, first_start, last_end, clean, btrim(p_name), p_phone, p_email,
    n, f.price_per_slot * slots * n, p_status,
    case when p_status = 'confirmed' then 'offline' else 'unpaid' end,
    case when p_status = 'confirmed' then 'offline' end,
    case when p_status = 'pending_payment' then now() + make_interval(mins => f.hold_minutes) end,
    case when p_status = 'confirmed' then now() end,
    p_by_admin, p_note
  ) returning * into o;

  -- every court row of every segment is inserted in this one transaction: all or nothing
  begin
    perform public._insert_order_rows(o, ids, p_status);
  exception when exclusion_violation then
    raise exception 'slot_unavailable';
  end;
  return o;
end $$;

create or replace function public.create_order(
  p_slug text, p_court_ids uuid[], p_date date, p_segments jsonb, p_name text, p_phone text
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  f public.facilities;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  holds int;
  o public.orders;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  -- the tenant is resolved HERE from the slug; the caller never supplies a facility id
  select * into f from public.facilities where slug = lower(btrim(coalesce(p_slug, '')));
  if f.id is null then raise exception 'facility_not_found'; end if;
  if f.status <> 'active' then raise exception 'facility_not_active'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'invalid_name'; end if;
  if v_phone !~ '^[0-9]{10,15}$' then raise exception 'invalid_phone'; end if;

  perform public.expire_stale_bookings();
  select count(*) into holds from public.orders where user_id = uid and facility_id = f.id and status = 'pending_payment';
  if holds >= f.max_unpaid_holds then raise exception 'too_many_unpaid_holds'; end if;

  o := public._create_order(f.id, uid, p_court_ids, p_date, p_segments, p_name, v_phone,
                            (select email from public.profiles where id = uid), 'pending_payment', false, null);
  update public.profiles set full_name = btrim(p_name), phone = v_phone, updated_at = now() where id = uid;
  return o;
end $$;

create or replace function public.get_busy_slots(p_slug text, p_date date)
returns table (court_id uuid, start_time time, end_time time, kind text, mine boolean)
language sql stable security definer set search_path = public as $$
  with f as (
    select id from public.facilities
     where slug = lower(btrim(coalesce(p_slug, ''))) and (status = 'active' or public.is_facility_member(id))
  )
  select b.court_id, b.start_time, b.end_time,
         case b.status when 'confirmed' then 'confirmed' else 'pending' end,
         (b.user_id is not null and b.user_id = auth.uid())
    from public.bookings b join f on f.id = b.facility_id
   where b.booking_date = p_date
     and (b.status in ('payment_submitted','confirmed')
          or (b.status = 'pending_payment' and (b.expires_at is null or b.expires_at >= now())))
  union all
  select k.court_id, k.start_time, k.end_time, 'blocked', false
    from public.blocked_slots k join f on f.id = k.facility_id
   where k.block_date = p_date;
$$;

create or replace function public.demo_pay_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  f public.facilities;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null or o.user_id is distinct from auth.uid() then raise exception 'booking_not_found'; end if;
  select * into f from public.facilities where id = o.facility_id;
  -- test payments only where the owner allowed them AND real payments are not configured
  if not f.allow_demo_payments or f.payment_mode = 'razorpay' then raise exception 'demo_payments_disabled'; end if;
  if o.status <> 'pending_payment' then raise exception 'booking_not_payable'; end if;
  if o.expires_at is not null and o.expires_at < now() then
    perform public.expire_stale_bookings();
    raise exception 'hold_expired';
  end if;
  update public.orders set status = 'confirmed', payment_status = 'demo', payment_method = 'demo',
         paid_at = now(), confirmed_at = now(), expires_at = null where id = o.id returning * into o;
  update public.bookings set status = 'confirmed', confirmed_at = now(), expires_at = null
   where order_id = o.id and status = 'pending_payment';
  return o;
end $$;

-- ---------------------------------------------------------------------
-- facility-owner RPCs (every one derives the facility server-side and checks membership)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_order_status(p_order_id uuid, p_status text, p_reason text)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'booking_not_found'; end if;
  perform public._require_member(o.facility_id);
  if p_status not in ('confirmed', 'cancelled') then raise exception 'invalid_status'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;

  if p_status = 'confirmed' then
    if o.status <> 'pending_payment' then raise exception 'invalid_status_transition: % -> confirmed', o.status; end if;
    update public.orders set status = 'confirmed', payment_status = 'offline', payment_method = 'offline',
           confirmed_at = now(), expires_at = null, admin_note = p_reason where id = o.id returning * into o;
    update public.bookings set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), expires_at = null
     where order_id = o.id and status = 'pending_payment';
  else
    update public.orders set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancellation_reason = p_reason,
           needs_refund = (payment_status = 'paid')
     where id = o.id returning * into o;
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancellation_reason = p_reason
     where order_id = o.id and status in ('pending_payment', 'confirmed');
  end if;

  perform public._log_event(o.facility_id, 'order_' || p_status, 'order', o.id,
                            jsonb_build_object('reference', o.reference, 'reason', p_reason));
  return o;
end $$;

create or replace function public.admin_mark_refunded(p_order_id uuid, p_note text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'booking_not_found'; end if;
  perform public._require_member(o.facility_id);
  update public.orders set payment_status = 'refunded', needs_refund = false,
         admin_note = coalesce(nullif(btrim(p_note), ''), admin_note)
   where id = p_order_id returning * into o;
  perform public._log_event(o.facility_id, 'refund_recorded', 'order', o.id, jsonb_build_object('reference', o.reference, 'note', p_note));
  return o;
end $$;

create or replace function public.admin_create_order(
  p_facility_id uuid, p_court_ids uuid[], p_date date, p_segments jsonb, p_name text, p_phone text,
  p_email text default null, p_confirm boolean default true, p_note text default null
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  o public.orders;
begin
  perform public._require_member(p_facility_id);
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'invalid_name'; end if;
  if v_phone !~ '^[0-9]{10,15}$' then raise exception 'invalid_phone'; end if;
  o := public._create_order(p_facility_id, null, p_court_ids, p_date, p_segments, p_name, v_phone,
                            nullif(btrim(coalesce(p_email, '')), ''),
                            case when p_confirm then 'confirmed' else 'pending_payment' end, true, p_note);
  perform public._log_event(p_facility_id, 'order_created_manually', 'order', o.id,
                            jsonb_build_object('reference', o.reference, 'confirmed', p_confirm));
  return o;
end $$;

create or replace function public.admin_create_block(
  p_court_id uuid, p_date date, p_start time, p_end time, p_reason text default null
) returns public.blocked_slots
language plpgsql security definer set search_path = public as $$
declare
  c public.courts;
  k public.blocked_slots;
begin
  select * into c from public.courts where id = p_court_id;
  if c.id is null then raise exception 'court_unavailable'; end if;
  perform public._require_member(c.facility_id);
  if p_start >= p_end then raise exception 'invalid_time_range'; end if;
  perform public.expire_stale_bookings();
  if exists (select 1 from public.bookings
              where court_id = p_court_id
                and status in ('pending_payment','payment_submitted','confirmed')
                and slot_range && tsrange(p_date + p_start, p_date + p_end, '[)')) then
    raise exception 'block_conflicts_with_booking';
  end if;
  begin
    insert into public.blocked_slots (facility_id, court_id, block_date, start_time, end_time, reason, created_by)
    values (c.facility_id, p_court_id, p_date, p_start, p_end, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
    returning * into k;
  exception when exclusion_violation then
    raise exception 'block_overlaps_block';
  end;
  perform public._log_event(c.facility_id, 'court_blocked', 'blocked_slot', k.id,
                            jsonb_build_object('court_id', p_court_id, 'date', p_date, 'start', p_start, 'end', p_end, 'reason', p_reason));
  return k;
end $$;

create or replace function public.admin_remove_block(p_block_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k public.blocked_slots;
begin
  select * into k from public.blocked_slots where id = p_block_id;
  if k.id is null then return; end if;
  perform public._require_member(k.facility_id);
  delete from public.blocked_slots where id = p_block_id;
  perform public._log_event(k.facility_id, 'court_unblocked', 'blocked_slot', p_block_id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- platform administrator RPCs (platform_admins allow-list only)
-- ---------------------------------------------------------------------
create or replace function public._require_platform_admin()
returns void language plpgsql stable as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
end $$;

create or replace function public.platform_list_facilities()
returns table (id uuid, slug text, name text, city text, status text, suspended_reason text, max_courts int,
               created_at timestamptz, owner_email text, owner_name text, courts bigint, orders bigint, verified_revenue numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_platform_admin();
  return query
    select f.id, f.slug, f.name, f.city, f.status, f.suspended_reason, f.max_courts, f.created_at,
           (select p.email from public.facility_members m join public.profiles p on p.id = m.user_id
             where m.facility_id = f.id and m.role = 'owner' order by m.created_at limit 1),
           (select p.full_name from public.facility_members m join public.profiles p on p.id = m.user_id
             where m.facility_id = f.id and m.role = 'owner' order by m.created_at limit 1),
           (select count(*) from public.courts c where c.facility_id = f.id),
           (select count(*) from public.orders o where o.facility_id = f.id),
           (select coalesce(sum(o.total_amount), 0) from public.orders o
             where o.facility_id = f.id and o.payment_status = 'paid' and not o.needs_refund)
      from public.facilities f order by f.created_at desc;
end $$;

create or replace function public.platform_list_owners()
returns table (user_id uuid, email text, full_name text, phone text, facilities bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_platform_admin();
  return query
    select p.id, p.email, p.full_name, p.phone,
           (select count(*) from public.facility_members m where m.user_id = p.id and m.role = 'owner'), p.created_at
      from public.profiles p
     where exists (select 1 from public.facility_members m where m.user_id = p.id)
     order by p.created_at desc;
end $$;

create or replace function public.platform_set_facility_status(p_fid uuid, p_status text, p_reason text default null)
returns public.facilities
language plpgsql security definer set search_path = public as $$
declare f public.facilities;
begin
  perform public._require_platform_admin();
  if p_status not in ('draft', 'pending', 'active', 'suspended') then raise exception 'invalid_status'; end if;
  if p_status = 'suspended' and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  update public.facilities
     set status = p_status, suspended_reason = case when p_status = 'suspended' then btrim(p_reason) else null end, updated_at = now()
   where id = p_fid returning * into f;
  if f.id is null then raise exception 'facility_not_found'; end if;
  perform public._log_event(p_fid, 'platform_status_' || p_status, 'facility', p_fid, jsonb_build_object('reason', p_reason));
  return f;
end $$;

create or replace function public.platform_set_slug(p_fid uuid, p_slug text)
returns public.facilities
language plpgsql security definer set search_path = public as $$
declare
  f public.facilities;
  v text := lower(btrim(coalesce(p_slug, '')));
begin
  perform public._require_platform_admin();
  if v !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' or v ~ '--' then raise exception 'invalid_slug'; end if;
  if exists (select 1 from public.reserved_slugs where slug = v) then raise exception 'slug_reserved'; end if;
  begin
    update public.facilities set slug = v, updated_at = now() where id = p_fid returning * into f;
  exception when unique_violation then
    raise exception 'slug_taken';
  end;
  if f.id is null then raise exception 'facility_not_found'; end if;
  perform public._log_event(p_fid, 'platform_slug_changed', 'facility', p_fid, jsonb_build_object('slug', v));
  return f;
end $$;

create or replace function public.platform_set_facility_limits(p_fid uuid, p_max_courts int, p_plan text default null)
returns public.facilities
language plpgsql security definer set search_path = public as $$
declare f public.facilities;
begin
  perform public._require_platform_admin();
  if p_max_courts is null or p_max_courts not between 1 and 50 then raise exception 'invalid_courts'; end if;
  update public.facilities set max_courts = p_max_courts, plan = coalesce(nullif(btrim(p_plan), ''), plan), updated_at = now()
   where id = p_fid returning * into f;
  if f.id is null then raise exception 'facility_not_found'; end if;
  perform public._log_event(p_fid, 'platform_limits_changed', 'facility', p_fid, jsonb_build_object('max_courts', p_max_courts, 'plan', p_plan));
  return f;
end $$;

create or replace function public.platform_metrics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_platform_admin();
  return jsonb_build_object(
    'facilities', (select count(*) from public.facilities),
    'facilities_active', (select count(*) from public.facilities where status = 'active'),
    'facilities_pending', (select count(*) from public.facilities where status = 'pending'),
    'facilities_suspended', (select count(*) from public.facilities where status = 'suspended'),
    'owners', (select count(distinct user_id) from public.facility_members where role = 'owner'),
    'players', (select count(distinct user_id) from public.orders where user_id is not null),
    'orders_total', (select count(*) from public.orders),
    'orders_confirmed', (select count(*) from public.orders where status = 'confirmed'),
    'orders_last_30d', (select count(*) from public.orders where created_at > now() - interval '30 days'),
    'verified_revenue', (select coalesce(sum(total_amount), 0) from public.orders where payment_status = 'paid' and not needs_refund)
  );
end $$;

create or replace function public.platform_get_settings()
returns setof public.platform_settings
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_platform_admin();
  return query select * from public.platform_settings order by key;
end $$;

create or replace function public.platform_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_platform_admin();
  if p_key not in ('require_facility_approval', 'max_facilities_per_owner', 'max_courts_per_facility') then raise exception 'invalid_status'; end if;
  if p_key = 'require_facility_approval' and jsonb_typeof(p_value) <> 'boolean' then raise exception 'invalid_status'; end if;
  if p_key <> 'require_facility_approval' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 50) then
    raise exception 'invalid_status';
  end if;
  update public.platform_settings set value = p_value, updated_at = now() where key = p_key;
  perform public._log_event(null, 'platform_setting_changed', 'platform_settings', null, jsonb_build_object('key', p_key, 'value', p_value));
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.platform_admins   enable row level security;
alter table public.platform_settings enable row level security;
alter table public.reserved_slugs    enable row level security;
alter table public.facilities        enable row level security;
alter table public.facility_members  enable row level security;

revoke all on public.platform_admins, public.platform_settings, public.reserved_slugs from anon, authenticated;
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());
grant select on public.platform_admins to authenticated;

-- facilities: members (and platform admins) read; ALL writes go through RPCs
create policy facilities_select on public.facilities for select to authenticated
  using (public.is_facility_member(id) or public.is_platform_admin());
revoke all on public.facilities from anon;
revoke insert, update, delete on public.facilities from authenticated;

create policy members_select on public.facility_members for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
revoke all on public.facility_members from anon;
revoke insert, update, delete on public.facility_members from authenticated;

-- profiles: own row only (platform admins may read all for owner management)
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_platform_admin());

-- courts: members manage their own facility's courts; the public gets courts via get_facility_public()
create policy courts_select on public.courts for select to authenticated
  using (public.is_facility_member(facility_id) or public.is_platform_admin());
create policy courts_insert on public.courts for insert to authenticated
  with check (public.is_facility_member(facility_id));
create policy courts_update on public.courts for update to authenticated
  using (public.is_facility_member(facility_id)) with check (public.is_facility_member(facility_id));
create policy courts_delete on public.courts for delete to authenticated
  using (public.is_facility_member(facility_id));
revoke all on public.courts from anon;
grant select, insert, delete on public.courts to authenticated;   -- (0001 revoked insert/delete); RLS limits rows to the caller's facility
revoke update on public.courts from authenticated;
grant update (name, image_url, is_active) on public.courts to authenticated;   -- facility_id / number are immutable

create policy orders_select on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_facility_member(facility_id));
create policy bookings_select on public.bookings for select to authenticated
  using (user_id = auth.uid() or public.is_facility_member(facility_id));
create policy blocks_select on public.blocked_slots for select to authenticated
  using (public.is_facility_member(facility_id));
create policy audit_select on public.audit_events for select to authenticated
  using ((facility_id is not null and public.is_facility_member(facility_id)) or public.is_platform_admin());
create policy payments_select on public.payment_submissions for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- ---------------------------------------------------------------------
-- function privileges: closed by default, open only the intended entry points
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

-- used inside RLS policies
grant execute on function public.is_facility_member(uuid) to authenticated;
grant execute on function public.is_platform_admin()      to authenticated;

-- public / tenant
grant execute on function public.get_facility_public(text)       to anon, authenticated;
grant execute on function public.list_public_facilities()        to anon, authenticated;
grant execute on function public.get_busy_slots(text, date)      to anon, authenticated;
grant execute on function public.expire_stale_bookings()         to authenticated;
grant execute on function public.create_order(text, uuid[], date, jsonb, text, text) to authenticated;
grant execute on function public.cancel_my_order(uuid)           to authenticated;
grant execute on function public.demo_pay_order(uuid)            to authenticated;

-- owners
grant execute on function public.check_slugs(text[])             to authenticated;
grant execute on function public.create_facility(jsonb)          to authenticated;
grant execute on function public.update_facility(uuid, jsonb)    to authenticated;
grant execute on function public.admin_set_order_status(uuid, text, text) to authenticated;
grant execute on function public.admin_mark_refunded(uuid, text) to authenticated;
grant execute on function public.admin_create_order(uuid, uuid[], date, jsonb, text, text, text, boolean, text) to authenticated;
grant execute on function public.admin_create_block(uuid, date, time, time, text) to authenticated;
grant execute on function public.admin_remove_block(uuid)        to authenticated;

-- platform administrators (each also re-checks platform_admins inside)
grant execute on function public.platform_list_facilities()      to authenticated;
grant execute on function public.platform_list_owners()          to authenticated;
grant execute on function public.platform_set_facility_status(uuid, text, text) to authenticated;
grant execute on function public.platform_set_slug(uuid, text)   to authenticated;
grant execute on function public.platform_set_facility_limits(uuid, int, text) to authenticated;
grant execute on function public.platform_metrics()              to authenticated;
grant execute on function public.platform_get_settings()         to authenticated;
grant execute on function public.platform_set_setting(text, jsonb) to authenticated;

-- payment settlement: Edge Functions only (service role)
grant execute on function public.finalize_order_payment(uuid, text, text, numeric) to service_role;

-- ---------------------------------------------------------------------
-- To create the FIRST platform administrator (run once, by you, in the SQL editor):
--   insert into public.platform_admins (user_id) select id from auth.users where email = 'you@example.com';
-- Nobody becomes a platform admin by registering.
-- ---------------------------------------------------------------------
