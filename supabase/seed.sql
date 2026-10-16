-- Development seed: exactly 3 courts. Facility settings row is created by the migration.
insert into public.courts (number, name) values
  (1, 'Court 1'),
  (2, 'Court 2'),
  (3, 'Court 3')
on conflict (number) do nothing;

-- Make yourself the owner AFTER you have signed up in the app (replace the email):
--   update public.profiles set role = 'owner' where email = 'you@example.com';
