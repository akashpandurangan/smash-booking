-- 0007: players can read the courts of THEIR OWN bookings (name / number / photo only).
--
-- Why: the player's "My bookings" / confirmation screens load orders with the court number embedded
-- (orders -> bookings -> courts). Since 0006 only facility members could read `courts`, so for a
-- player the embedded court came back empty and bookings showed no court number.
--
-- Scope: a signed-in user sees ONLY courts that appear in a booking they made. Nothing else changes:
-- other courts, other facilities and every write path stay exactly as 0006 left them.
create policy courts_select_booked on public.courts for select to authenticated
  using (exists (select 1 from public.bookings b where b.court_id = courts.id and b.user_id = auth.uid()));
