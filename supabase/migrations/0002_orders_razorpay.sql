-- =====================================================================
-- 0002: multi-court orders, single 30-minute slot, Razorpay payment.
-- Run AFTER 0001_schema.sql.
--
-- Model: an ORDER is one date + one 30-minute slot + 1..N courts.
--        Each court in the order is a row in `bookings` (the lock rows that the
--        exclusion constraint protects), all created in ONE transaction, so
--        either every selected court is reserved or none is.
-- =====================================================================

-- ---------------------------------------------------------------------
-- settings: 14-day window, demo-payment switch
-- ---------------------------------------------------------------------
alter table public.facility_settings drop constraint if exists facility_settings_advance_booking_days_check;
update public.facility_settings set advance_booking_days = 14 where advance_booking_days > 14;
alter table public.facility_settings alter column advance_booking_days set default 14;
alter table public.facility_settings add constraint facility_settings_advance_booking_days_check
  check (advance_booking_days between 1 and 14);
-- Lets customers "pay" without Razorpay. Keep FALSE in production; use only for testing.
alter table public.facility_settings add column if not exists allow_demo_payments boolean not null default false;

-- ---------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------
create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique,
  user_id              uuid references auth.users(id) on delete set null,
  booking_date         date not null,
  start_time           time not null,
  end_time             time not null,
  customer_name        text not null check (char_length(customer_name) between 2 and 80),
  customer_phone       text not null check (customer_phone ~ '^[0-9]{10,15}$'),
  customer_email       text,
  court_count          int  not null check (court_count between 1 and 20),
  total_amount         numeric(10,2) not null check (total_amount >= 0),
  status               text not null default 'pending_payment'
                         check (status in ('pending_payment','confirmed','cancelled','expired')),
  payment_status       text not null default 'unpaid'
                         check (payment_status in ('unpaid','paid','offline','demo','refunded')),
  payment_method       text check (payment_method in ('razorpay','demo','offline')),
  razorpay_order_id    text,
  razorpay_payment_id  text,
  paid_at              timestamptz,
  needs_refund         boolean not null default false,   -- paid, but the slot could not be given
  expires_at           timestamptz,
  confirmed_at         timestamptz,
  cancelled_at         timestamptz,
  cancelled_by         uuid references auth.users(id),
  cancellation_reason  text,
  created_by_admin     boolean not null default false,
  admin_note           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint order_time_valid check (start_time < end_time)
);

create index orders_user_idx on public.orders (user_id, booking_date desc);
create index orders_date_idx on public.orders (booking_date);
create index orders_status_idx on public.orders (status);
-- a Razorpay payment id can only ever settle one order (replay protection)
create unique index orders_rzp_payment_uq on public.orders (razorpay_payment_id) where razorpay_payment_id is not null;
create index orders_rzp_order_idx on public.orders (razorpay_order_id) where razorpay_order_id is not null;

alter table public.bookings add column order_id uuid references public.orders(id) on delete cascade;
create index bookings_order_idx on public.bookings (order_id);
-- one reference per ORDER now (shared by its court rows)
alter table public.bookings drop constraint if exists bookings_reference_key;

-- carry over anything created under 0001: one order per old booking
insert into public.orders (id, reference, user_id, booking_date, start_time, end_time, customer_name, customer_phone,
                           customer_email, court_count, total_amount, status, payment_status, payment_method,
                           expires_at, confirmed_at, cancelled_at, cancelled_by, cancellation_reason,
                           created_by_admin, admin_note, created_at)
select id, reference, user_id, booking_date, start_time, end_time, customer_name, customer_phone,
       customer_email, 1, total_amount,
       case when status = 'payment_submitted' then 'pending_payment' else status end,
       case when status = 'confirmed' then 'offline' else 'unpaid' end,
       case when status = 'confirmed' then 'offline' end,
       expires_at, confirmed_at, cancelled_at, cancelled_by, cancellation_reason, created_by_admin, admin_note, created_at
  from public.bookings;
update public.bookings set order_id = id where order_id is null;
alter table public.bookings alter column order_id set not null;

-- order status machine (expired -> confirmed only happens for a late, verified payment)
create or replace function public.enforce_order_transition()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending_payment' and new.status in ('confirmed','cancelled','expired')) or
      (old.status = 'confirmed'       and new.status = 'cancelled') or
      (old.status = 'expired'         and new.status = 'confirmed')
    ) then
      raise exception 'invalid_status_transition: % -> %', old.status, new.status;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger orders_transition before update on public.orders
  for each row execute function public.enforce_order_transition();

-- ---------------------------------------------------------------------
-- retire the 0001 single-booking / manual-UPI functions
-- ---------------------------------------------------------------------
drop function if exists public.create_booking(uuid,date,time,time,text,text);
drop function if exists public.submit_payment(uuid,text,text);
drop function if exists public.cancel_my_booking(uuid);
drop function if exists public.admin_review_payment(uuid,boolean,text);
drop function if exists public.admin_set_booking_status(uuid,text,text);
drop function if exists public.admin_create_booking(uuid,date,time,time,text,text,text,boolean,text);
drop function if exists public._create_booking(uuid,uuid,date,time,time,text,text,text,text,boolean,text);

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------
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
    exit when not exists (select 1 from public.orders where reference = ref);
  end loop;
  return ref;
end $$;

create or replace function public.expire_stale_bookings()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with e as (
    update public.orders set status = 'expired'
     where status = 'pending_payment' and expires_at is not null and expires_at < now()
    returning id)
  update public.bookings set status = 'expired'
   where order_id in (select id from e) and status = 'pending_payment';
  get diagnostics n = row_count;
  return n;
end $$;

-- court rows for an order. Called inside the caller's transaction: if ANY court
-- conflicts the exclusion constraint raises and the whole order rolls back.
create or replace function public._insert_order_rows(o public.orders, p_court_ids uuid[], p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  foreach cid in array p_court_ids loop   -- ids are sorted: stable lock order, no deadlocks
    insert into public.bookings (
      reference, user_id, court_id, booking_date, start_time, end_time,
      customer_name, customer_phone, customer_email, total_amount, advance_amount,
      status, expires_at, created_by_admin, admin_note, confirmed_at, order_id
    ) values (
      o.reference, o.user_id, cid, o.booking_date, o.start_time, o.end_time,
      o.customer_name, o.customer_phone, o.customer_email,
      o.total_amount / o.court_count, o.total_amount / o.court_count,
      p_status, case when p_status = 'pending_payment' then o.expires_at end,
      o.created_by_admin, o.admin_note, case when p_status = 'confirmed' then now() end, o.id
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- internal order creator (customer + owner flows)
-- ---------------------------------------------------------------------
create or replace function public._create_order(
  p_user uuid, p_court_ids uuid[], p_date date, p_start time,
  p_name text, p_phone text, p_email text, p_status text, p_by_admin boolean, p_note text
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  s public.facility_settings;
  ids uuid[];
  n int;
  end_t time;
  o public.orders;
begin
  select * into s from public.facility_settings where id = 1;
  select array_agg(distinct x order by x) into ids from unnest(coalesce(p_court_ids, '{}')) x;
  n := coalesce(array_length(ids, 1), 0);
  if n < 1 then raise exception 'no_courts_selected'; end if;
  if n <> (select count(*) from public.courts where id = any(ids) and is_active) then
    raise exception 'court_unavailable';
  end if;

  end_t := p_start + make_interval(mins => s.slot_minutes);   -- exactly ONE slot
  if end_t <= p_start or p_start < s.opening_time or end_t > s.closing_time then
    raise exception 'outside_operating_hours';
  end if;
  if mod(extract(epoch from (p_start - s.opening_time)) / 60, s.slot_minutes) <> 0 then
    raise exception 'invalid_slot';
  end if;

  if not p_by_admin then
    if (p_date + p_start) <= public._facility_now() then raise exception 'slot_in_past'; end if;
    if p_date > public._facility_now()::date + (s.advance_booking_days - 1) then raise exception 'too_far_ahead'; end if;
  end if;

  perform public.expire_stale_bookings();

  if exists (select 1 from public.blocked_slots
              where court_id = any(ids)
                and slot_range && tsrange(p_date + p_start, p_date + end_t, '[)')) then
    raise exception 'slot_blocked';
  end if;

  insert into public.orders (
    reference, user_id, booking_date, start_time, end_time, customer_name, customer_phone, customer_email,
    court_count, total_amount, status, payment_status, payment_method, expires_at, confirmed_at,
    created_by_admin, admin_note
  ) values (
    public._new_reference(), p_user, p_date, p_start, end_t, btrim(p_name), p_phone, p_email,
    n, s.price_per_slot * n, p_status,
    case when p_status = 'confirmed' then 'offline' else 'unpaid' end,
    case when p_status = 'confirmed' then 'offline' end,
    case when p_status = 'pending_payment' then now() + make_interval(mins => s.hold_minutes) end,
    case when p_status = 'confirmed' then now() end,
    p_by_admin, p_note
  ) returning * into o;

  begin
    perform public._insert_order_rows(o, ids, p_status);
  exception when exclusion_violation then
    raise exception 'slot_unavailable';
  end;
  return o;
end $$;

-- ---------------------------------------------------------------------
-- customer RPCs
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_court_ids uuid[], p_date date, p_start time, p_name text, p_phone text
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  holds int;
  maxh int;
  o public.orders;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'invalid_name'; end if;
  if v_phone !~ '^[0-9]{10,15}$' then raise exception 'invalid_phone'; end if;

  perform public.expire_stale_bookings();
  select max_unpaid_holds into maxh from public.facility_settings where id = 1;
  select count(*) into holds from public.orders where user_id = uid and status = 'pending_payment';
  if holds >= maxh then raise exception 'too_many_unpaid_holds'; end if;

  o := public._create_order(uid, p_court_ids, p_date, p_start, p_name, v_phone,
                            (select email from public.profiles where id = uid), 'pending_payment', false, null);
  update public.profiles set full_name = btrim(p_name), phone = v_phone, updated_at = now() where id = uid;
  return o;
end $$;

create or replace function public.cancel_my_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null or o.user_id is distinct from auth.uid() then raise exception 'booking_not_found'; end if;
  if o.status <> 'pending_payment' then raise exception 'contact_owner_to_cancel'; end if;
  update public.orders set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancellation_reason = 'Cancelled by customer' where id = o.id returning * into o;
  update public.bookings set status = 'cancelled' where order_id = o.id and status = 'pending_payment';
  return o;
end $$;

-- TEST-ONLY payment: works only while the owner has switched allow_demo_payments on.
create or replace function public.demo_pay_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not (select allow_demo_payments from public.facility_settings where id = 1) then
    raise exception 'demo_payments_disabled';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null or o.user_id is distinct from auth.uid() then raise exception 'booking_not_found'; end if;
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
-- Razorpay settlement. ONLY the Edge Functions (service role) may call this,
-- and only after they verified the signature / payment with Razorpay.
-- ---------------------------------------------------------------------
create or replace function public.finalize_order_payment(
  p_order_id uuid, p_rzp_order text, p_rzp_payment text, p_amount numeric
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  ids uuid[];
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'booking_not_found'; end if;
  if o.razorpay_order_id is distinct from p_rzp_order then raise exception 'razorpay_order_mismatch'; end if;
  if p_amount is distinct from o.total_amount then raise exception 'amount_mismatch'; end if;

  if o.razorpay_payment_id = p_rzp_payment then return o; end if;          -- idempotent (webhook + client)
  if o.razorpay_payment_id is not null then raise exception 'already_paid'; end if;

  if o.status = 'pending_payment' then
    update public.orders set status = 'confirmed', payment_status = 'paid', payment_method = 'razorpay',
           razorpay_payment_id = p_rzp_payment, paid_at = now(), confirmed_at = now(), expires_at = null
     where id = o.id returning * into o;
    update public.bookings set status = 'confirmed', confirmed_at = now(), expires_at = null
     where order_id = o.id and status = 'pending_payment';

  elsif o.status = 'expired' then
    -- paid after the hold lapsed: re-claim the same courts if they are still free
    select array_agg(distinct court_id order by court_id) into ids from public.bookings where order_id = o.id;
    begin
      perform public._insert_order_rows(o, ids, 'confirmed');
      update public.orders set status = 'confirmed', payment_status = 'paid', payment_method = 'razorpay',
             razorpay_payment_id = p_rzp_payment, paid_at = now(), confirmed_at = now(), expires_at = null
       where id = o.id returning * into o;
    exception when exclusion_violation then
      update public.orders set payment_status = 'paid', payment_method = 'razorpay',
             razorpay_payment_id = p_rzp_payment, paid_at = now(), needs_refund = true
       where id = o.id returning * into o;
    end;

  else -- cancelled: money arrived for a booking that no longer exists
    update public.orders set payment_status = 'paid', payment_method = 'razorpay',
           razorpay_payment_id = p_rzp_payment, paid_at = now(), needs_refund = true
     where id = o.id returning * into o;
  end if;
  return o;
end $$;

-- ---------------------------------------------------------------------
-- owner RPCs
-- ---------------------------------------------------------------------
create or replace function public.admin_set_order_status(p_order_id uuid, p_status text, p_reason text)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform public._require_owner();
  if p_status not in ('confirmed', 'cancelled') then raise exception 'invalid_status'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'booking_not_found'; end if;

  if p_status = 'confirmed' then
    if o.status <> 'pending_payment' then raise exception 'invalid_status_transition: % -> confirmed', o.status; end if;
    update public.orders set status = 'confirmed', payment_status = 'offline', payment_method = 'offline',
           confirmed_at = now(), expires_at = null, admin_note = p_reason where id = o.id returning * into o;
    update public.bookings set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), expires_at = null
     where order_id = o.id and status = 'pending_payment';
  else
    update public.orders set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancellation_reason = p_reason,
           needs_refund = (payment_status = 'paid')            -- paid online: flag until you refund it
     where id = o.id returning * into o;
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancellation_reason = p_reason
     where order_id = o.id and status in ('pending_payment', 'confirmed');
  end if;

  perform public._log_event('order_' || p_status, 'order', o.id,
                            jsonb_build_object('reference', o.reference, 'reason', p_reason));
  return o;
end $$;

create or replace function public.admin_mark_refunded(p_order_id uuid, p_note text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  perform public._require_owner();
  update public.orders set payment_status = 'refunded', needs_refund = false,
         admin_note = coalesce(nullif(btrim(p_note), ''), admin_note)
   where id = p_order_id returning * into o;
  if o.id is null then raise exception 'booking_not_found'; end if;
  perform public._log_event('refund_recorded', 'order', o.id, jsonb_build_object('reference', o.reference, 'note', p_note));
  return o;
end $$;

create or replace function public.admin_create_order(
  p_court_ids uuid[], p_date date, p_start time, p_name text, p_phone text,
  p_email text default null, p_confirm boolean default true, p_note text default null
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  o public.orders;
begin
  perform public._require_owner();
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'invalid_name'; end if;
  if v_phone !~ '^[0-9]{10,15}$' then raise exception 'invalid_phone'; end if;
  o := public._create_order(null, p_court_ids, p_date, p_start, p_name, v_phone,
                            nullif(btrim(coalesce(p_email, '')), ''),
                            case when p_confirm then 'confirmed' else 'pending_payment' end, true, p_note);
  perform public._log_event('order_created_manually', 'order', o.id,
                            jsonb_build_object('reference', o.reference, 'confirmed', p_confirm));
  return o;
end $$;

-- ---------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------
alter table public.orders enable row level security;
create policy orders_select on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_owner());
revoke all on public.orders from anon;
revoke insert, update, delete on public.orders from authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_owner()                       to authenticated;
grant execute on function public.get_busy_slots(date)             to anon, authenticated;
grant execute on function public.expire_stale_bookings()          to authenticated;
grant execute on function public.create_order(uuid[],date,time,text,text) to authenticated;
grant execute on function public.cancel_my_order(uuid)            to authenticated;
grant execute on function public.demo_pay_order(uuid)             to authenticated;
grant execute on function public.admin_set_order_status(uuid,text,text) to authenticated;
grant execute on function public.admin_mark_refunded(uuid,text)   to authenticated;
grant execute on function public.admin_create_order(uuid[],date,time,text,text,text,boolean,text) to authenticated;
grant execute on function public.admin_create_block(uuid,date,time,time,text) to authenticated;
grant execute on function public.admin_remove_block(uuid)         to authenticated;
-- payment settlement: Edge Functions only (service role), never the browser
grant execute on function public.finalize_order_payment(uuid,text,text,numeric) to service_role;
