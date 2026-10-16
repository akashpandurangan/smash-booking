-- =====================================================================
-- Badminton court booking — schema, constraints, RLS and RPC functions
-- Run in the Supabase SQL editor (or `supabase db push`).
-- All writes to bookings go through SECURITY DEFINER functions so that
-- availability is re-checked transactionally and the DB enforces rules.
-- =====================================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- profiles (one per auth user). `role` can only be changed via SQL.
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  email       text,
  role        text not null default 'customer' check (role in ('customer', 'owner')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email,
          nullif(new.raw_user_meta_data ->> 'full_name', ''),
          nullif(new.raw_user_meta_data ->> 'phone', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

-- ---------------------------------------------------------------------
-- facility settings (single row) — everything configurable lives here
-- ---------------------------------------------------------------------
create table public.facility_settings (
  id                    int primary key default 1 check (id = 1),
  name                  text not null default 'Smash Court',
  tagline               text not null default 'Your Court. Your Game.',
  address               text not null default 'Your address here',
  contact_phone         text,
  contact_email         text,
  opening_time          time not null default '06:00',
  closing_time          time not null default '22:00',
  slot_minutes          int  not null default 30 check (slot_minutes between 15 and 120),
  price_per_slot        numeric(10,2) not null default 150 check (price_per_slot >= 0),
  advance_per_slot      numeric(10,2) not null default 50  check (advance_per_slot >= 0),
  max_slots_per_booking int  not null default 4 check (max_slots_per_booking between 1 and 24),
  max_unpaid_holds      int  not null default 2 check (max_unpaid_holds between 1 and 10),
  hold_minutes          int  not null default 15 check (hold_minutes between 5 and 1440),
  advance_booking_days  int  not null default 30 check (advance_booking_days between 1 and 365),
  timezone              text not null default 'Asia/Kolkata',
  upi_id                text check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9]{2,64}$'),
  upi_payee_name        text,
  upi_qr_url            text check (upi_qr_url is null or upi_qr_url ~ '^https://'),
  cancellation_policy   text not null default 'Contact the facility to cancel a confirmed booking.',
  updated_at            timestamptz not null default now(),
  constraint hours_valid check (opening_time < closing_time)
);

insert into public.facility_settings (id) values (1);

-- ---------------------------------------------------------------------
-- courts
-- ---------------------------------------------------------------------
create table public.courts (
  id         uuid primary key default gen_random_uuid(),
  number     int  not null unique check (number > 0),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------
create table public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique,
  user_id              uuid references auth.users(id) on delete set null,   -- null = walk-in created by owner
  court_id             uuid not null references public.courts(id),
  booking_date         date not null,
  start_time           time not null,
  end_time             time not null,
  slot_range           tsrange generated always as
                         (tsrange(booking_date + start_time, booking_date + end_time, '[)')) stored,
  customer_name        text not null check (char_length(customer_name) between 2 and 80),
  customer_phone       text not null check (customer_phone ~ '^[0-9]{10,15}$'),
  customer_email       text,
  total_amount         numeric(10,2) not null check (total_amount >= 0),
  advance_amount       numeric(10,2) not null check (advance_amount >= 0 and advance_amount <= total_amount),
  status               text not null default 'pending_payment'
                         check (status in ('pending_payment','payment_submitted','confirmed','cancelled','expired')),
  expires_at           timestamptz,                    -- hold expiry while unpaid
  payment_submitted_at timestamptz,
  confirmed_at         timestamptz,
  confirmed_by         uuid references auth.users(id),
  cancelled_at         timestamptz,
  cancelled_by         uuid references auth.users(id),
  cancellation_reason  text,
  created_by_admin     boolean not null default false,
  admin_note           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint booking_time_valid check (start_time < end_time),
  -- THE conflict guarantee: a court can't have two active bookings with overlapping ranges.
  constraint bookings_no_overlap exclude using gist (court_id with =, slot_range with &&)
    where (status in ('pending_payment','payment_submitted','confirmed'))
);

create index bookings_user_idx on public.bookings (user_id, booking_date desc);
create index bookings_date_idx on public.bookings (booking_date, court_id);
create index bookings_status_idx on public.bookings (status);

-- explicit state machine
create or replace function public.enforce_booking_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending_payment'   and new.status in ('payment_submitted','confirmed','cancelled','expired')) or
      (old.status = 'payment_submitted' and new.status in ('confirmed','pending_payment','cancelled')) or
      (old.status = 'confirmed'         and new.status = 'cancelled')
    ) then
      raise exception 'invalid_status_transition: % -> %', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger bookings_transition
  before update on public.bookings
  for each row execute function public.enforce_booking_transition();

-- ---------------------------------------------------------------------
-- payment submissions (customer-claimed; NOT proof of payment)
-- ---------------------------------------------------------------------
create table public.payment_submissions (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings(id) on delete cascade,
  user_id       uuid references auth.users(id),
  utr           text not null check (utr ~ '^[A-Za-z0-9]{8,22}$'),
  amount        numeric(10,2) not null check (amount >= 0),
  payer_note    text check (payer_note is null or char_length(payer_note) <= 300),
  status        text not null default 'submitted' check (status in ('submitted','approved','rejected')),
  review_reason text,
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  submitted_at  timestamptz not null default now()
);

create index payment_submissions_booking_idx on public.payment_submissions (booking_id);
-- the same UTR can't back two live claims
create unique index payment_submissions_utr_live on public.payment_submissions (upper(utr))
  where status <> 'rejected';

-- ---------------------------------------------------------------------
-- blocked slots (maintenance / private use)
-- ---------------------------------------------------------------------
create table public.blocked_slots (
  id          uuid primary key default gen_random_uuid(),
  court_id    uuid not null references public.courts(id) on delete cascade,
  block_date  date not null,
  start_time  time not null,
  end_time    time not null,
  slot_range  tsrange generated always as
                (tsrange(block_date + start_time, block_date + end_time, '[)')) stored,
  reason      text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  constraint block_time_valid check (start_time < end_time),
  constraint blocks_no_overlap exclude using gist (court_id with =, slot_range with &&)
);

create index blocked_slots_date_idx on public.blocked_slots (block_date, court_id);

-- ---------------------------------------------------------------------
-- audit trail for administrative actions
-- ---------------------------------------------------------------------
create table public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id),
  actor_email text,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_events_created_idx on public.audit_events (created_at desc);

create or replace function public._log_event(p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events (actor_id, actor_email, action, entity_type, entity_id, details)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------
create or replace function public._facility_now()
returns timestamp language sql stable as $$
  select now() at time zone (select timezone from public.facility_settings where id = 1);
$$;

create or replace function public._new_reference()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  ref text;
  i int;
begin
  loop
    ref := 'BK-';
    for i in 1..6 loop
      ref := ref || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.bookings where reference = ref);
  end loop;
  return ref;
end $$;

-- Release unpaid holds whose time ran out so they stop blocking slots.
create or replace function public.expire_stale_bookings()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.bookings
     set status = 'expired'
   where status = 'pending_payment' and expires_at is not null and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- internal booking creator (shared by customer and owner flows)
-- ---------------------------------------------------------------------
create or replace function public._create_booking(
  p_user uuid, p_court uuid, p_date date, p_start time, p_end time,
  p_name text, p_phone text, p_email text, p_status text, p_by_admin boolean, p_note text
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  s public.facility_settings;
  c public.courts;
  mins numeric;
  slots int;
  total numeric(10,2);
  adv numeric(10,2);
  b public.bookings;
begin
  select * into s from public.facility_settings where id = 1;
  select * into c from public.courts where id = p_court;
  if c.id is null or not c.is_active then raise exception 'court_unavailable'; end if;

  if p_start >= p_end then raise exception 'invalid_time_range'; end if;
  if p_start < s.opening_time or p_end > s.closing_time then raise exception 'outside_operating_hours'; end if;

  mins := extract(epoch from (p_end - p_start)) / 60;
  if mod(mins, s.slot_minutes) <> 0
     or mod(extract(epoch from (p_start - s.opening_time)) / 60, s.slot_minutes) <> 0 then
    raise exception 'invalid_slot';
  end if;
  slots := (mins / s.slot_minutes)::int;
  if slots > s.max_slots_per_booking then raise exception 'too_many_slots'; end if;

  if not p_by_admin then
    if (p_date + p_start) <= public._facility_now() then raise exception 'slot_in_past'; end if;
    if p_date > public._facility_now()::date + s.advance_booking_days then raise exception 'too_far_ahead'; end if;
  end if;

  perform public.expire_stale_bookings();

  if exists (select 1 from public.blocked_slots
              where court_id = p_court
                and slot_range && tsrange(p_date + p_start, p_date + p_end, '[)')) then
    raise exception 'slot_blocked';
  end if;

  total := s.price_per_slot * slots;
  adv   := least(total, s.advance_per_slot * slots);

  begin
    insert into public.bookings (
      reference, user_id, court_id, booking_date, start_time, end_time,
      customer_name, customer_phone, customer_email, total_amount, advance_amount,
      status, expires_at, created_by_admin, admin_note,
      confirmed_at, confirmed_by
    ) values (
      public._new_reference(), p_user, p_court, p_date, p_start, p_end,
      btrim(p_name), p_phone, p_email, total, adv,
      p_status,
      case when p_status = 'pending_payment' then now() + make_interval(mins => s.hold_minutes) end,
      p_by_admin, p_note,
      case when p_status = 'confirmed' then now() end,
      case when p_status = 'confirmed' then auth.uid() end
    ) returning * into b;
  exception when exclusion_violation then
    raise exception 'slot_unavailable';
  end;

  return b;
end $$;

-- ---------------------------------------------------------------------
-- customer RPCs
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_court_id uuid, p_date date, p_start time, p_end time, p_name text, p_phone text
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  holds int;
  maxh int;
  b public.bookings;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'invalid_name'; end if;
  if v_phone !~ '^[0-9]{10,15}$' then raise exception 'invalid_phone'; end if;

  perform public.expire_stale_bookings();
  select max_unpaid_holds into maxh from public.facility_settings where id = 1;
  select count(*) into holds from public.bookings where user_id = uid and status = 'pending_payment';
  if holds >= maxh then raise exception 'too_many_unpaid_holds'; end if;

  b := public._create_booking(uid, p_court_id, p_date, p_start, p_end, p_name, v_phone,
                              (select email from public.profiles where id = uid), 'pending_payment', false, null);

  update public.profiles set full_name = btrim(p_name), phone = v_phone, updated_at = now() where id = uid;
  return b;
end $$;

create or replace function public.submit_payment(p_booking_id uuid, p_utr text, p_note text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  v_utr text := upper(btrim(coalesce(p_utr, '')));
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_utr !~ '^[A-Z0-9]{8,22}$' then raise exception 'invalid_utr'; end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or b.user_id is distinct from auth.uid() then raise exception 'booking_not_found'; end if;
  if b.status <> 'pending_payment' then raise exception 'booking_not_payable'; end if;
  if b.expires_at is not null and b.expires_at < now() then
    perform public.expire_stale_bookings();
    raise exception 'hold_expired';
  end if;

  begin
    insert into public.payment_submissions (booking_id, user_id, utr, amount, payer_note)
    values (b.id, auth.uid(), v_utr, b.advance_amount, nullif(btrim(coalesce(p_note, '')), ''));
  exception when unique_violation then
    raise exception 'utr_already_used';
  end;

  update public.bookings
     set status = 'payment_submitted', payment_submitted_at = now(), expires_at = null
   where id = b.id returning * into b;
  return b;
end $$;

create or replace function public.cancel_my_booking(p_booking_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or b.user_id is distinct from auth.uid() then raise exception 'booking_not_found'; end if;
  -- once payment was claimed or confirmed, the owner must handle it (refunds etc.)
  if b.status <> 'pending_payment' then raise exception 'contact_owner_to_cancel'; end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancellation_reason = 'Cancelled by customer'
   where id = b.id returning * into b;
  return b;
end $$;

-- Anonymised availability: no personal data leaves the database.
create or replace function public.get_busy_slots(p_date date)
returns table (court_id uuid, start_time time, end_time time, kind text, mine boolean)
language sql stable security definer set search_path = public as $$
  select b.court_id, b.start_time, b.end_time,
         case b.status when 'confirmed' then 'confirmed' else 'pending' end,
         (b.user_id is not null and b.user_id = auth.uid())
    from public.bookings b
   where b.booking_date = p_date
     and (b.status in ('payment_submitted','confirmed')
          or (b.status = 'pending_payment' and (b.expires_at is null or b.expires_at >= now())))
  union all
  select k.court_id, k.start_time, k.end_time, 'blocked', false
    from public.blocked_slots k
   where k.block_date = p_date;
$$;

-- ---------------------------------------------------------------------
-- owner RPCs (each checks is_owner() and writes an audit event)
-- ---------------------------------------------------------------------
create or replace function public._require_owner()
returns void language plpgsql stable as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
end $$;

create or replace function public.admin_review_payment(p_booking_id uuid, p_approve boolean, p_reason text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  b public.bookings;
  hold int;
begin
  perform public._require_owner();
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then raise exception 'booking_not_found'; end if;
  if b.status <> 'payment_submitted' then raise exception 'no_payment_to_review'; end if;
  if not p_approve and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;

  update public.payment_submissions
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
   where booking_id = b.id and status = 'submitted';

  if p_approve then
    update public.bookings set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
     where id = b.id returning * into b;
  else
    select hold_minutes into hold from public.facility_settings where id = 1;
    -- payment rejected: give the customer another chance within a fresh hold
    update public.bookings
       set status = 'pending_payment', expires_at = now() + make_interval(mins => hold), payment_submitted_at = null
     where id = b.id returning * into b;
  end if;

  perform public._log_event(case when p_approve then 'payment_approved' else 'payment_rejected' end,
                            'booking', b.id, jsonb_build_object('reference', b.reference, 'reason', p_reason));
  return b;
end $$;

create or replace function public.admin_set_booking_status(p_booking_id uuid, p_status text, p_reason text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  perform public._require_owner();
  if p_status not in ('confirmed', 'cancelled') then raise exception 'invalid_status'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null then raise exception 'booking_not_found'; end if;

  if p_status = 'confirmed' then
    update public.bookings set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(),
           expires_at = null, admin_note = p_reason
     where id = b.id returning * into b;
    update public.payment_submissions set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_reason = p_reason where booking_id = b.id and status = 'submitted';
  else
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancellation_reason = p_reason
     where id = b.id returning * into b;
  end if;

  perform public._log_event('booking_' || p_status, 'booking', b.id,
                            jsonb_build_object('reference', b.reference, 'reason', p_reason));
  return b;
end $$;

create or replace function public.admin_create_booking(
  p_court_id uuid, p_date date, p_start time, p_end time,
  p_name text, p_phone text, p_email text default null,
  p_confirm boolean default true, p_note text default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  b public.bookings;
begin
  perform public._require_owner();
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'invalid_name'; end if;
  if v_phone !~ '^[0-9]{10,15}$' then raise exception 'invalid_phone'; end if;
  b := public._create_booking(null, p_court_id, p_date, p_start, p_end, p_name, v_phone,
                              nullif(btrim(coalesce(p_email, '')), ''),
                              case when p_confirm then 'confirmed' else 'pending_payment' end, true, p_note);
  perform public._log_event('booking_created_manually', 'booking', b.id,
                            jsonb_build_object('reference', b.reference, 'confirmed', p_confirm));
  return b;
end $$;

create or replace function public.admin_create_block(
  p_court_id uuid, p_date date, p_start time, p_end time, p_reason text default null
) returns public.blocked_slots
language plpgsql security definer set search_path = public as $$
declare k public.blocked_slots;
begin
  perform public._require_owner();
  if p_start >= p_end then raise exception 'invalid_time_range'; end if;
  perform public.expire_stale_bookings();
  if exists (select 1 from public.bookings
              where court_id = p_court_id
                and status in ('pending_payment','payment_submitted','confirmed')
                and slot_range && tsrange(p_date + p_start, p_date + p_end, '[)')) then
    raise exception 'block_conflicts_with_booking';
  end if;
  begin
    insert into public.blocked_slots (court_id, block_date, start_time, end_time, reason, created_by)
    values (p_court_id, p_date, p_start, p_end, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
    returning * into k;
  exception when exclusion_violation then
    raise exception 'block_overlaps_block';
  end;
  perform public._log_event('court_blocked', 'blocked_slot', k.id,
                            jsonb_build_object('court_id', p_court_id, 'date', p_date, 'start', p_start, 'end', p_end, 'reason', p_reason));
  return k;
end $$;

create or replace function public.admin_remove_block(p_block_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._require_owner();
  delete from public.blocked_slots where id = p_block_id;
  perform public._log_event('court_unblocked', 'blocked_slot', p_block_id, '{}'::jsonb);
end $$;

-- settings changes are audited by trigger (the table itself is owner-write via RLS)
create or replace function public._audit_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  perform public._log_event('settings_updated', 'facility_settings', null,
    jsonb_build_object('old_upi_id', old.upi_id, 'new_upi_id', new.upi_id,
                       'price_per_slot', new.price_per_slot, 'advance_per_slot', new.advance_per_slot));
  return new;
end $$;

create trigger facility_settings_audit
  before update on public.facility_settings
  for each row execute function public._audit_settings();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.facility_settings   enable row level security;
alter table public.courts              enable row level security;
alter table public.bookings            enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.blocked_slots       enable row level security;
alter table public.audit_events        enable row level security;

-- profiles: read own (owner reads all); update only name/phone on own row
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated, anon;

-- settings + courts: public read, owner write
create policy settings_read  on public.facility_settings for select to anon, authenticated using (true);
create policy settings_write on public.facility_settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
revoke insert, delete on public.facility_settings from authenticated, anon;

create policy courts_read  on public.courts for select to anon, authenticated using (true);
create policy courts_write on public.courts for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
revoke insert, delete on public.courts from authenticated, anon;

-- bookings: read own or all (owner). NO direct writes — only via RPCs above.
create policy bookings_select on public.bookings for select to authenticated
  using (user_id = auth.uid() or public.is_owner());
revoke insert, update, delete on public.bookings from authenticated, anon;
revoke all on public.bookings from anon;

create policy payments_select on public.payment_submissions for select to authenticated
  using (user_id = auth.uid() or public.is_owner());
revoke insert, update, delete on public.payment_submissions from authenticated, anon;
revoke all on public.payment_submissions from anon;

create policy blocks_select on public.blocked_slots for select to authenticated using (public.is_owner());
revoke insert, update, delete on public.blocked_slots from authenticated, anon;
revoke all on public.blocked_slots from anon;

create policy audit_select on public.audit_events for select to authenticated using (public.is_owner());
revoke insert, update, delete on public.audit_events from authenticated, anon;
revoke all on public.audit_events from anon;

-- function privileges: lock everything down, then open only the intended entry points
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_owner()                 to authenticated;
grant execute on function public.get_busy_slots(date)       to anon, authenticated;
grant execute on function public.create_booking(uuid,date,time,time,text,text) to authenticated;
grant execute on function public.submit_payment(uuid,text,text)   to authenticated;
grant execute on function public.cancel_my_booking(uuid)          to authenticated;
grant execute on function public.admin_review_payment(uuid,boolean,text)  to authenticated;
grant execute on function public.admin_set_booking_status(uuid,text,text) to authenticated;
grant execute on function public.admin_create_booking(uuid,date,time,time,text,text,text,boolean,text) to authenticated;
grant execute on function public.admin_create_block(uuid,date,time,time,text) to authenticated;
grant execute on function public.admin_remove_block(uuid)         to authenticated;
grant execute on function public.expire_stale_bookings()          to authenticated;  -- idempotent housekeeping
-- Optionally also schedule it with pg_cron (see README).
