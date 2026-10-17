-- 0005: the booking page now offers 1-4 hour durations = up to 8 half-hour slots.
-- Raise the per-booking cap (default was 4 slots = 2 hours). Safe to re-run.
alter table public.facility_settings alter column max_slots_per_booking set default 8;
update public.facility_settings set max_slots_per_booking = 8 where max_slots_per_booking < 8;
