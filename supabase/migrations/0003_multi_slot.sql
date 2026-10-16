-- =====================================================================
-- 0003: a booking may span several CONSECUTIVE 30-minute slots.
-- Run after 0002. The order's start/end now come from the caller; the database
-- validates alignment, opening hours, and the max-slots limit itself.
-- total = price_per_slot x number_of_slots x number_of_courts
-- =====================================================================

drop function if exists public.create_order(uuid[], date, time, text, text);
drop function if exists public.admin_create_order(uuid[], date, time, text, text, text, boolean, text);
drop function if exists public._create_order(uuid, uuid[], date, time, text, text, text, text, boolean, text);

create or replace function public._create_order(
  p_user uuid, p_court_ids uuid[], p_date date, p_start time, p_end time,
  p_name text, p_phone text, p_email text, p_status text, p_by_admin boolean, p_note text
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  s public.facility_settings;
  ids uuid[];
  n int;
  mins numeric;
  slots int;
  o public.orders;
begin
  select * into s from public.facility_settings where id = 1;
  select array_agg(distinct x order by x) into ids from unnest(coalesce(p_court_ids, '{}')) x;
  n := coalesce(array_length(ids, 1), 0);
  if n < 1 then raise exception 'no_courts_selected'; end if;
  if n <> (select count(*) from public.courts where id = any(ids) and is_active) then
    raise exception 'court_unavailable';
  end if;

  if p_end <= p_start then raise exception 'invalid_time_range'; end if;
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
    if p_date > public._facility_now()::date + (s.advance_booking_days - 1) then raise exception 'too_far_ahead'; end if;
  end if;

  perform public.expire_stale_bookings();

  if exists (select 1 from public.blocked_slots
              where court_id = any(ids)
                and slot_range && tsrange(p_date + p_start, p_date + p_end, '[)')) then
    raise exception 'slot_blocked';
  end if;

  insert into public.orders (
    reference, user_id, booking_date, start_time, end_time, customer_name, customer_phone, customer_email,
    court_count, total_amount, status, payment_status, payment_method, expires_at, confirmed_at,
    created_by_admin, admin_note
  ) values (
    public._new_reference(), p_user, p_date, p_start, p_end, btrim(p_name), p_phone, p_email,
    n, s.price_per_slot * slots * n, p_status,
    case when p_status = 'confirmed' then 'offline' else 'unpaid' end,
    case when p_status = 'confirmed' then 'offline' end,
    case when p_status = 'pending_payment' then now() + make_interval(mins => s.hold_minutes) end,
    case when p_status = 'confirmed' then now() end,
    p_by_admin, p_note
  ) returning * into o;

  -- every court row is inserted in this same transaction: all courts or none
  begin
    perform public._insert_order_rows(o, ids, p_status);
  exception when exclusion_violation then
    raise exception 'slot_unavailable';
  end;
  return o;
end $$;

create or replace function public.create_order(
  p_court_ids uuid[], p_date date, p_start time, p_end time, p_name text, p_phone text
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

  o := public._create_order(uid, p_court_ids, p_date, p_start, p_end, p_name, v_phone,
                            (select email from public.profiles where id = uid), 'pending_payment', false, null);
  update public.profiles set full_name = btrim(p_name), phone = v_phone, updated_at = now() where id = uid;
  return o;
end $$;

create or replace function public.admin_create_order(
  p_court_ids uuid[], p_date date, p_start time, p_end time, p_name text, p_phone text,
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
  o := public._create_order(null, p_court_ids, p_date, p_start, p_end, p_name, v_phone,
                            nullif(btrim(coalesce(p_email, '')), ''),
                            case when p_confirm then 'confirmed' else 'pending_payment' end, true, p_note);
  perform public._log_event('order_created_manually', 'order', o.id,
                            jsonb_build_object('reference', o.reference, 'confirmed', p_confirm));
  return o;
end $$;

-- new functions get default grants (PUBLIC/anon): lock them down explicitly
revoke execute on function public._create_order(uuid, uuid[], date, time, time, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.create_order(uuid[], date, time, time, text, text) from public, anon;
revoke execute on function public.admin_create_order(uuid[], date, time, time, text, text, text, boolean, text) from public, anon;
grant execute on function public.create_order(uuid[], date, time, time, text, text) to authenticated;
grant execute on function public.admin_create_order(uuid[], date, time, time, text, text, text, boolean, text) to authenticated;
