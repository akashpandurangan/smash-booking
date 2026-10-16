-- =====================================================================
-- 0004: an order may contain SEVERAL separate time ranges ("segments"),
-- e.g. 2:00-2:30 PM and 5:00-5:30 PM on the same day. Run after 0003.
--
-- orders.segments = [{"start":"14:00","end":"14:30"}, {"start":"17:00","end":"17:30"}]
-- orders.start_time / end_time remain the earliest start / latest end (for sorting/display).
-- One `bookings` lock row is created per court per segment, all in one transaction, so
-- the exclusion constraint still guarantees no double-booking and the order is all-or-nothing.
-- total = price_per_slot x total_slots x courts
-- =====================================================================

alter table public.orders add column if not exists segments jsonb not null default '[]'::jsonb;
update public.orders
   set segments = jsonb_build_array(jsonb_build_object('start', to_char(start_time, 'HH24:MI'), 'end', to_char(end_time, 'HH24:MI')))
 where segments = '[]'::jsonb;

drop function if exists public.create_order(uuid[], date, time, time, text, text);
drop function if exists public.admin_create_order(uuid[], date, time, time, text, text, text, boolean, text);
drop function if exists public._create_order(uuid, uuid[], date, time, time, text, text, text, text, boolean, text);

-- court rows: one per court per segment
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
        reference, user_id, court_id, booking_date, start_time, end_time,
        customer_name, customer_phone, customer_email, total_amount, advance_amount,
        status, expires_at, created_by_admin, admin_note, confirmed_at, order_id
      ) values (
        o.reference, o.user_id, cid, o.booking_date, seg.seg_s, seg.seg_e,
        o.customer_name, o.customer_phone, o.customer_email,
        o.total_amount / nrows, o.total_amount / nrows,
        p_status, case when p_status = 'pending_payment' then o.expires_at end,
        o.created_by_admin, o.admin_note, case when p_status = 'confirmed' then now() end, o.id
      );
    end loop;
  end loop;
end $$;

create or replace function public._create_order(
  p_user uuid, p_court_ids uuid[], p_date date, p_segments jsonb,
  p_name text, p_phone text, p_email text, p_status text, p_by_admin boolean, p_note text
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  s public.facility_settings;
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
  select * into s from public.facility_settings where id = 1;
  select array_agg(distinct x order by x) into ids from unnest(coalesce(p_court_ids, '{}')) x;
  n := coalesce(array_length(ids, 1), 0);
  if n < 1 then raise exception 'no_courts_selected'; end if;
  if n <> (select count(*) from public.courts where id = any(ids) and is_active) then
    raise exception 'court_unavailable';
  end if;

  if p_segments is null or jsonb_typeof(p_segments) <> 'array' or jsonb_array_length(p_segments) = 0 then
    raise exception 'invalid_slot';
  end if;

  -- validate every segment (ordered, non-overlapping, aligned, inside opening hours)
  for seg in select (x."start")::time as seg_s, (x."end")::time as seg_e
               from jsonb_to_recordset(p_segments) as x("start" text, "end" text) order by 1 loop
    if seg.seg_e <= seg.seg_s then raise exception 'invalid_time_range'; end if;
    if seg.seg_s < s.opening_time or seg.seg_e > s.closing_time then raise exception 'outside_operating_hours'; end if;
    mins := extract(epoch from (seg.seg_e - seg.seg_s)) / 60;
    if mod(mins, s.slot_minutes) <> 0
       or mod(extract(epoch from (seg.seg_s - s.opening_time)) / 60, s.slot_minutes) <> 0 then
      raise exception 'invalid_slot';
    end if;
    if prev_end is not null and seg.seg_s < prev_end then raise exception 'invalid_slot'; end if;
    prev_end := seg.seg_e;
    slots := slots + (mins / s.slot_minutes)::int;
    first_start := coalesce(first_start, seg.seg_s);
    last_end := seg.seg_e;
    clean := clean || jsonb_build_object('start', to_char(seg.seg_s, 'HH24:MI'), 'end', to_char(seg.seg_e, 'HH24:MI'));
    if not p_by_admin and (p_date + seg.seg_s) <= public._facility_now() then raise exception 'slot_in_past'; end if;
    if exists (select 1 from public.blocked_slots
                where court_id = any(ids)
                  and slot_range && tsrange(p_date + seg.seg_s, p_date + seg.seg_e, '[)')) then
      raise exception 'slot_blocked';
    end if;
  end loop;
  if slots > s.max_slots_per_booking then raise exception 'too_many_slots'; end if;
  if not p_by_admin and p_date > public._facility_now()::date + (s.advance_booking_days - 1) then
    raise exception 'too_far_ahead';
  end if;

  perform public.expire_stale_bookings();

  insert into public.orders (
    reference, user_id, booking_date, start_time, end_time, segments, customer_name, customer_phone, customer_email,
    court_count, total_amount, status, payment_status, payment_method, expires_at, confirmed_at,
    created_by_admin, admin_note
  ) values (
    public._new_reference(), p_user, p_date, first_start, last_end, clean, btrim(p_name), p_phone, p_email,
    n, s.price_per_slot * slots * n, p_status,
    case when p_status = 'confirmed' then 'offline' else 'unpaid' end,
    case when p_status = 'confirmed' then 'offline' end,
    case when p_status = 'pending_payment' then now() + make_interval(mins => s.hold_minutes) end,
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
  p_court_ids uuid[], p_date date, p_segments jsonb, p_name text, p_phone text
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

  o := public._create_order(uid, p_court_ids, p_date, p_segments, p_name, v_phone,
                            (select email from public.profiles where id = uid), 'pending_payment', false, null);
  update public.profiles set full_name = btrim(p_name), phone = v_phone, updated_at = now() where id = uid;
  return o;
end $$;

create or replace function public.admin_create_order(
  p_court_ids uuid[], p_date date, p_segments jsonb, p_name text, p_phone text,
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
  o := public._create_order(null, p_court_ids, p_date, p_segments, p_name, v_phone,
                            nullif(btrim(coalesce(p_email, '')), ''),
                            case when p_confirm then 'confirmed' else 'pending_payment' end, true, p_note);
  perform public._log_event('order_created_manually', 'order', o.id,
                            jsonb_build_object('reference', o.reference, 'confirmed', p_confirm));
  return o;
end $$;

-- new functions get default grants: lock them down explicitly
revoke execute on function public._insert_order_rows(public.orders, uuid[], text) from public, anon, authenticated;
revoke execute on function public._create_order(uuid, uuid[], date, jsonb, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.create_order(uuid[], date, jsonb, text, text) from public, anon;
revoke execute on function public.admin_create_order(uuid[], date, jsonb, text, text, text, boolean, text) from public, anon;
grant execute on function public.create_order(uuid[], date, jsonb, text, text) to authenticated;
grant execute on function public.admin_create_order(uuid[], date, jsonb, text, text, text, boolean, text) to authenticated;
