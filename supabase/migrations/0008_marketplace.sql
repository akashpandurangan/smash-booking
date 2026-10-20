-- =====================================================================
-- 0008: MARKETPLACE — facility profile, per-court prices, banners, public search
--
--  * facilities: description, locality, postal code, Google Maps link, optional latitude/longitude,
--    cover image, amenities (fixed list)            -> all validated IN THE DATABASE
--  * courts.price_per_hour: optional per-court price (falls back to the facility price)
--  * facility_banners: up to 3 promotional banners per facility, written only by that facility's members
--  * search_public_facilities(): public search over ACTIVE facilities (text, date, time, distance) with
--    availability computed from real bookings / blocks / opening hours / holidays
--  * storage: public-read bucket `facility-media`; only members of facility <id> may write under <id>/
--  * pricing: an order's total is now the sum of each selected court's own price (or the facility price)
--
-- Safe on a database that already has 0001–0007 applied. Nothing is dropped or deleted; existing
-- facilities, courts, bookings and prices keep working unchanged (court price NULL = facility price).
-- =====================================================================

-- ---------------------------------------------------------------------
-- validators / helpers (not callable by browsers)
-- ---------------------------------------------------------------------
create or replace function public._valid_maps_url(u text)
returns boolean language sql immutable as $$
  select u is null or (
    length(u) <= 500 and u !~ '\s' and (
         u ~* '^https://(www\.)?google\.[a-z.]{2,10}/maps([/?#].*)?$'
      or u ~* '^https://maps\.google\.[a-z.]{2,10}(/.*)?$'
      or u ~* '^https://maps\.app\.goo\.gl/[a-z0-9_-]+([/?#].*)?$'
      or u ~* '^https://goo\.gl/maps/[a-z0-9_-]+([/?#].*)?$'));
$$;

create or replace function public._clean_amenities(p jsonb)
returns text[] language sql immutable as $$
  select coalesce(array(select distinct x from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x order by x), '{}');
$$;

create or replace function public._court_price(c jsonb)
returns numeric language plpgsql immutable as $$
declare v text := nullif(btrim(coalesce(c ->> 'price_per_hour', '')), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]+(\.[0-9]{1,2})?$' or v::numeric > 100000 then raise exception 'invalid_price'; end if;
  return v::numeric;
end $$;

-- Raises a specific error for every profile field that is present but invalid. Used by create + update.
create or replace function public._validate_profile(p jsonb)
returns void language plpgsql stable set search_path = public as $$
declare
  v_lat text := nullif(btrim(coalesce(p ->> 'latitude', '')), '');
  v_lng text := nullif(btrim(coalesce(p ->> 'longitude', '')), '');
  a text;
  allowed text[] := array['parking','restrooms','drinking_water','changing_rooms','showers','seating','equipment_rental','coaching','cafe','wifi','first_aid','air_conditioned'];
begin
  if char_length(coalesce(p ->> 'description', '')) > 2000 then raise exception 'description_too_long'; end if;
  if char_length(coalesce(p ->> 'locality', '')) > 80 then raise exception 'invalid_address'; end if;
  if nullif(btrim(coalesce(p ->> 'postal_code', '')), '') is not null and btrim(p ->> 'postal_code') !~ '^[1-9][0-9]{5}$' then
    raise exception 'invalid_postal_code';
  end if;
  if not public._valid_maps_url(nullif(btrim(coalesce(p ->> 'maps_url', '')), '')) then raise exception 'invalid_maps_url'; end if;
  if v_lat is not null or v_lng is not null then
    if v_lat is null or v_lng is null or v_lat !~ '^-?[0-9]+(\.[0-9]+)?$' or v_lng !~ '^-?[0-9]+(\.[0-9]+)?$'
       or v_lat::numeric not between -90 and 90 or v_lng::numeric not between -180 and 180 then
      raise exception 'invalid_location';
    end if;
  end if;
  if nullif(btrim(coalesce(p ->> 'cover_image_url', '')), '') is not null
     and (btrim(p ->> 'cover_image_url') !~ '^https://[^\s]+$' or char_length(p ->> 'cover_image_url') > 500) then
    raise exception 'invalid_image_url';
  end if;
  if p ? 'amenities' then
    if jsonb_typeof(p -> 'amenities') <> 'array' then raise exception 'invalid_amenities'; end if;
    for a in select jsonb_array_elements_text(p -> 'amenities') loop
      if not (a = any(allowed)) then raise exception 'invalid_amenities'; end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- new columns (existing rows get safe defaults)
-- ---------------------------------------------------------------------
alter table public.facilities
  add column if not exists description     text not null default '',
  add column if not exists locality        text not null default '',
  add column if not exists postal_code     text,
  add column if not exists maps_url        text,
  add column if not exists latitude        numeric(9,6),
  add column if not exists longitude       numeric(9,6),
  add column if not exists cover_image_url text,
  add column if not exists amenities       text[] not null default '{}';

alter table public.facilities
  add constraint facilities_description_len check (char_length(description) <= 2000),
  add constraint facilities_locality_len    check (char_length(locality) <= 80),
  add constraint facilities_postal_code_ok  check (postal_code is null or postal_code ~ '^[1-9][0-9]{5}$'),
  add constraint facilities_maps_url_ok     check (public._valid_maps_url(maps_url)),
  add constraint facilities_lat_ok          check (latitude is null or latitude between -90 and 90),
  add constraint facilities_lng_ok          check (longitude is null or longitude between -180 and 180),
  add constraint facilities_latlng_pair     check ((latitude is null) = (longitude is null)),
  add constraint facilities_cover_ok        check (cover_image_url is null or (cover_image_url ~ '^https://[^\s]+$' and char_length(cover_image_url) <= 500)),
  add constraint facilities_amenities_ok    check (amenities <@ array['parking','restrooms','drinking_water','changing_rooms','showers','seating','equipment_rental','coaching','cafe','wifi','first_aid','air_conditioned']);

create index if not exists facilities_city_idx on public.facilities (lower(city)) where status = 'active';

alter table public.courts
  add column if not exists price_per_hour numeric(10,2) check (price_per_hour is null or (price_per_hour >= 0 and price_per_hour <= 100000));
grant update (price_per_hour) on public.courts to authenticated;   -- RLS still limits this to the caller's own facility

-- ---------------------------------------------------------------------
-- banners (max 3 per facility)
-- ---------------------------------------------------------------------
create table public.facility_banners (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  position    smallint not null check (position between 0 and 2),
  image_url   text not null check (image_url ~ '^https://[^\s]+$' and char_length(image_url) <= 500),
  heading     text check (heading is null or char_length(heading) <= 80),
  description text check (description is null or char_length(description) <= 200),
  cta_label   text check (cta_label is null or char_length(cta_label) <= 30),
  created_at  timestamptz not null default now(),
  unique (facility_id, position)
);
alter table public.facility_banners enable row level security;
revoke all on public.facility_banners from anon;
revoke insert, update, delete on public.facility_banners from authenticated;   -- writes only via save_facility_banners()
create policy banners_select on public.facility_banners for select to authenticated
  using (public.is_facility_member(facility_id) or public.is_platform_admin());

create or replace function public.save_facility_banners(p_fid uuid, p jsonb)
returns setof public.facility_banners
language plpgsql security definer set search_path = public as $$
declare
  b jsonb;
  i smallint := 0;
begin
  perform public._require_member(p_fid);
  if jsonb_typeof(p) <> 'array' then raise exception 'invalid_banners'; end if;
  if jsonb_array_length(p) > 3 then raise exception 'too_many_banners'; end if;
  for b in select * from jsonb_array_elements(p) loop
    if coalesce(b ->> 'image_url', '') !~ '^https://[^\s]+$' or char_length(b ->> 'image_url') > 500 then raise exception 'invalid_image_url'; end if;
    if char_length(coalesce(b ->> 'heading', '')) > 80 or char_length(coalesce(b ->> 'description', '')) > 200
       or char_length(coalesce(b ->> 'cta_label', '')) > 30 then raise exception 'banner_text_too_long'; end if;
  end loop;
  delete from public.facility_banners where facility_id = p_fid;
  for b in select * from jsonb_array_elements(p) loop
    insert into public.facility_banners (facility_id, position, image_url, heading, description, cta_label)
    values (p_fid, i, btrim(b ->> 'image_url'), nullif(btrim(coalesce(b ->> 'heading', '')), ''),
            nullif(btrim(coalesce(b ->> 'description', '')), ''), nullif(btrim(coalesce(b ->> 'cta_label', '')), ''));
    i := i + 1;
  end loop;
  perform public._log_event(p_fid, 'banners_updated', 'facility', p_fid, jsonb_build_object('count', i));
  return query select * from public.facility_banners where facility_id = p_fid order by position;
end $$;

-- ---------------------------------------------------------------------
-- public search over ACTIVE facilities. Availability is derived from real data only:
--   'not_checked'  no date given            'unverifiable' date outside the booking window / already past
--   'closed'       weekly day off or holiday            'open'  free_hours / courts_free_at_time are real counts
-- ---------------------------------------------------------------------
create or replace function public.search_public_facilities(
  p_query text default null, p_date date default null, p_time time default null,
  p_lat numeric default null, p_lng numeric default null
) returns table (
  slug text, name text, tagline text, city text, locality text, address text, logo_url text, cover_image_url text,
  amenities text[], maps_url text, latitude numeric, longitude numeric,
  min_price_per_hour numeric, court_count int, distance_km numeric,
  availability text, free_hours numeric, courts_free_at_time int
)
language sql stable security definer set search_path = public as $$
  with q as (
    select nullif(btrim(coalesce(p_query, '')), '') as t,
           case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end as lat,
           case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end as lng
  ),
  pat as (
    select case when t is null then null
                else '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' end as p
      from q
  ),
  base as (
    select f.*,
           (select count(*)::int from public.courts c where c.facility_id = f.id and c.is_active) as n_courts,
           (select min(coalesce(c.price_per_hour, f.price_per_slot * 2)) from public.courts c where c.facility_id = f.id and c.is_active) as min_price,
           (now() at time zone f.timezone) as local_now
      from public.facilities f, pat
     where f.status = 'active'
       and (pat.p is null or f.name ilike pat.p or f.city ilike pat.p or f.locality ilike pat.p
                          or f.address ilike pat.p or coalesce(f.postal_code, '') ilike pat.p)
  ),
  st as (
    select b.*,
           case when p_date is null then 'not_checked'
                when p_date < b.local_now::date or p_date > b.local_now::date + (b.advance_booking_days - 1) then 'unverifiable'
                when extract(dow from p_date)::smallint = any(b.closed_weekdays) or p_date = any(b.holidays) then 'closed'
                else 'open' end as avail
      from base b
  )
  select s.slug, s.name, s.tagline, s.city, s.locality, s.address, s.logo_url, s.cover_image_url, s.amenities, s.maps_url,
         s.latitude, s.longitude, s.min_price, s.n_courts,
         case when q.lat is not null and s.latitude is not null then
           round((6371 * 2 * asin(least(1, sqrt(
             power(sin(radians(s.latitude - q.lat) / 2), 2) +
             cos(radians(q.lat)) * cos(radians(s.latitude)) * power(sin(radians(s.longitude - q.lng) / 2), 2)))))::numeric, 1) end,
         s.avail,
         case when s.avail = 'open' then
           (select count(*) * s.slot_minutes / 60.0
              from public.courts c
              cross join lateral generate_series(p_date + s.opening_time, p_date + s.closing_time - make_interval(mins => s.slot_minutes), make_interval(mins => s.slot_minutes)) g(t)
             where c.facility_id = s.id and c.is_active and g.t > s.local_now
               and not exists (select 1 from public.bookings k
                                where k.court_id = c.id and k.slot_range && tsrange(g.t, g.t + make_interval(mins => s.slot_minutes), '[)')
                                  and (k.status in ('payment_submitted', 'confirmed') or (k.status = 'pending_payment' and (k.expires_at is null or k.expires_at >= now()))))
               and not exists (select 1 from public.blocked_slots x
                                where x.court_id = c.id and x.slot_range && tsrange(g.t, g.t + make_interval(mins => s.slot_minutes), '[)'))) end,
         case when s.avail = 'open' and p_time is not null then
           case when p_time < s.opening_time or p_time + interval '1 hour' > s.closing_time or (p_date + p_time) <= s.local_now then 0
           else (select count(*)::int from public.courts c
                  where c.facility_id = s.id and c.is_active
                    and not exists (select 1 from public.bookings k
                                     where k.court_id = c.id and k.slot_range && tsrange(p_date + p_time, p_date + p_time + interval '1 hour', '[)')
                                       and (k.status in ('payment_submitted', 'confirmed') or (k.status = 'pending_payment' and (k.expires_at is null or k.expires_at >= now()))))
                    and not exists (select 1 from public.blocked_slots x
                                     where x.court_id = c.id and x.slot_range && tsrange(p_date + p_time, p_date + p_time + interval '1 hour', '[)'))) end end
    from st s, q
   order by 15 asc nulls last, s.name
   limit 60;
$$;

-- ---------------------------------------------------------------------
-- storage: public-read images, writable only by members of the facility whose id is the first path segment
-- (created only where Supabase Storage exists; skipped on plain Postgres)
-- ---------------------------------------------------------------------
create or replace function public.can_manage_media(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when split_part(coalesce(p_name, ''), '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_facility_member(split_part(p_name, '/', 1)::uuid) else false end;
$$;

do $storage$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('facility-media', 'facility-media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    drop policy if exists "facility media: members read"   on storage.objects;
    drop policy if exists "facility media: members insert" on storage.objects;
    drop policy if exists "facility media: members update" on storage.objects;
    drop policy if exists "facility media: members delete" on storage.objects;
    create policy "facility media: members read"   on storage.objects for select to authenticated using (bucket_id = 'facility-media' and public.can_manage_media(name));
    create policy "facility media: members insert" on storage.objects for insert to authenticated with check (bucket_id = 'facility-media' and public.can_manage_media(name));
    create policy "facility media: members update" on storage.objects for update to authenticated using (bucket_id = 'facility-media' and public.can_manage_media(name)) with check (bucket_id = 'facility-media' and public.can_manage_media(name));
    create policy "facility media: members delete" on storage.objects for delete to authenticated using (bucket_id = 'facility-media' and public.can_manage_media(name));
  end if;
end
$storage$;

-- ---------------------------------------------------------------------
-- re-created functions (same signatures as 0006, so their grants are kept)
-- ---------------------------------------------------------------------
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
  v_unit numeric;
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

  -- price per 30-min slot, summed over the selected courts: a court's own hourly price (/2) if set, else the facility's
  select coalesce(sum(coalesce(round(c.price_per_hour / 2, 2), f.price_per_slot)), 0) into v_unit
    from public.courts c where c.id = any(ids) and c.facility_id = p_facility;

  insert into public.orders (
    facility_id, reference, user_id, booking_date, start_time, end_time, segments, customer_name, customer_phone, customer_email,
    court_count, total_amount, status, payment_status, payment_method, expires_at, confirmed_at,
    created_by_admin, admin_note
  ) values (
    p_facility, public._new_reference(), p_user, p_date, first_start, last_end, clean, btrim(p_name), p_phone, p_email,
    n, v_unit * slots, p_status,
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
      'payment_mode', f.payment_mode, 'razorpay_key_id', f.razorpay_key_id,
      'description', f.description, 'locality', f.locality, 'postal_code', f.postal_code, 'maps_url', f.maps_url,
      'latitude', f.latitude, 'longitude', f.longitude, 'cover_image_url', f.cover_image_url, 'amenities', f.amenities),
    'courts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'name', c.name,
                                                             'image_url', c.image_url, 'is_active', c.is_active,
                                                             'price_per_hour', c.price_per_hour) order by c.number)
                          from public.courts c where c.facility_id = f.id), '[]'::jsonb),
    'banners', coalesce((select jsonb_agg(jsonb_build_object('position', b.position, 'image_url', b.image_url, 'heading', b.heading,
                                                              'description', b.description, 'cta_label', b.cta_label) order by b.position)
                           from public.facility_banners b where b.facility_id = f.id), '[]'::jsonb));
end $$;

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

  perform public._validate_profile(p);

  v_status := case when coalesce((public._platform_setting('require_facility_approval'))::text::boolean, false) then 'pending' else 'active' end;

  begin
    insert into public.facilities (
      slug, name, tagline, logo_url, address, city, contact_phone, contact_email, status, max_courts,
      opening_time, closing_time, price_per_slot, max_slots_per_booking, available_durations,
      closed_weekdays, holidays, cancellation_policy, created_by,
      description, locality, postal_code, maps_url, latitude, longitude, cover_image_url, amenities
    ) values (
      v_slug, v_name, coalesce(nullif(btrim(p ->> 'tagline'), ''), 'Your Court. Your Game.'),
      nullif(btrim(p ->> 'logo_url'), ''), btrim(p ->> 'address'), btrim(p ->> 'city'), v_phone,
      nullif(btrim(coalesce(p ->> 'contact_email', '')), ''), v_status, v_max_courts,
      v_open, v_close, round(v_hourly / 2, 2), greatest((select max(d) from unnest(v_durs) d) * 2, 2), v_durs,
      coalesce(array(select (x)::smallint from jsonb_array_elements_text(coalesce(p -> 'closed_weekdays', '[]'::jsonb)) x), '{}'),
      coalesce(array(select (x)::date from jsonb_array_elements_text(coalesce(p -> 'holidays', '[]'::jsonb)) x), '{}'),
      coalesce(nullif(btrim(p ->> 'cancellation_policy'), ''), 'Contact the facility to cancel a confirmed booking.'),
      uid,
      btrim(coalesce(p ->> 'description', '')), btrim(coalesce(p ->> 'locality', '')), nullif(btrim(coalesce(p ->> 'postal_code', '')), ''),
      nullif(btrim(coalesce(p ->> 'maps_url', '')), ''), nullif(btrim(coalesce(p ->> 'latitude', '')), '')::numeric,
      nullif(btrim(coalesce(p ->> 'longitude', '')), '')::numeric, nullif(btrim(coalesce(p ->> 'cover_image_url', '')), ''),
      public._clean_amenities(p -> 'amenities')
    ) returning * into f;
  exception when unique_violation then
    raise exception 'slug_taken';
  end;

  insert into public.facility_members (facility_id, user_id, role) values (f.id, uid, 'owner');

  for c in select * from jsonb_array_elements(v_courts) loop
    i := i + 1;
    insert into public.courts (facility_id, number, name, image_url, price_per_hour)
    values (f.id, i, coalesce(nullif(btrim(c ->> 'name'), ''), 'Court ' || i), nullif(btrim(c ->> 'image_url'), ''), public._court_price(c));
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
  perform public._validate_profile(p);
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
    description = case when p ? 'description' then btrim(coalesce(p ->> 'description', '')) else description end,
    locality = case when p ? 'locality' then btrim(coalesce(p ->> 'locality', '')) else locality end,
    postal_code = case when p ? 'postal_code' then nullif(btrim(coalesce(p ->> 'postal_code', '')), '') else postal_code end,
    maps_url = case when p ? 'maps_url' then nullif(btrim(coalesce(p ->> 'maps_url', '')), '') else maps_url end,
    latitude = case when p ? 'latitude' then nullif(btrim(coalesce(p ->> 'latitude', '')), '')::numeric else latitude end,
    longitude = case when p ? 'longitude' then nullif(btrim(coalesce(p ->> 'longitude', '')), '')::numeric else longitude end,
    cover_image_url = case when p ? 'cover_image_url' then nullif(btrim(coalesce(p ->> 'cover_image_url', '')), '') else cover_image_url end,
    amenities = case when p ? 'amenities' then public._clean_amenities(p -> 'amenities') else amenities end,
    updated_at = now()
  where id = p_fid returning * into f;

  perform public._log_event(p_fid, 'facility_updated', 'facility', p_fid,
                            jsonb_build_object('fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return f;
end $$;

-- ---------------------------------------------------------------------
-- function privileges: closed by default, then open exactly what is needed
-- ---------------------------------------------------------------------
revoke execute on function public._valid_maps_url(text), public._clean_amenities(jsonb), public._court_price(jsonb), public._validate_profile(jsonb)
  from public, anon, authenticated;
revoke execute on function public.save_facility_banners(uuid, jsonb), public.search_public_facilities(text, date, time, numeric, numeric), public.can_manage_media(text)
  from public, anon, authenticated;
grant execute on function public.search_public_facilities(text, date, time, numeric, numeric) to anon, authenticated;
grant execute on function public.save_facility_banners(uuid, jsonb) to authenticated;
grant execute on function public.can_manage_media(text) to authenticated;   -- used by the storage policies
