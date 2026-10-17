# Smash Booking — multi-tenant badminton court booking

A platform where **each facility owner registers, sets up their courts, and automatically gets their own booking website** at `<name>.smashbooking.com` — all served by **one shared app** (no per-owner deployments).

**Stack:** React 19 + Vite, Tailwind v4, React Router, Supabase (Auth + Postgres + RLS + Edge Functions), Razorpay. Plain JavaScript/JSX.

## What's in it

| Area | Where | What |
|---|---|---|
| Platform site | `/` (primary domain) | landing page + directory of live facilities |
| Owner registration & login | `/owner/register`, `/owner/login` | email/password, verification, password reset — separate from player login |
| Setup wizard | `/owner/setup` | facility → web address (auto-slug + suggestions) → courts → hours/durations/pricing/days off → payments → review & activate |
| Owner dashboard | `/owner/*` | overview, bookings, calendar, courts & blocks, payments, booking page (link, subdomain status, branding), settings, activity log |
| Platform admin | `/platform/*` | all facilities/owners, approve · suspend · reactivate, address changes, limits, usage metrics, platform settings |
| Facility booking site | `<slug>.<root domain>` or `/f/<slug>` | the player experience (date → duration → time → court → pay), per-facility data, prices, hours, branding |

## Run it (₹0, no setup) — demo mode

```bash
npm install
npm run dev        # http://localhost:5173
```
No `.env.local` → **demo mode** (amber banner): local sample facilities (**Smash Arena**, **Green Shuttle Club**), pretend payments, nothing leaves your browser.
- Platform: <http://localhost:5173/> — `/owner/login` has *Demo owner* and *Demo platform admin*; or register a new owner and run the wizard.
- Facility sites: <http://localhost:5173/f/smasharena> · <http://smasharena.localhost:5173/> (real hostname routing, no DNS) · `/?facility=smasharena`.

## Production

Everything is in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**: Supabase setup and migrations, the first platform administrator, env vars, Vercel + wildcard DNS (`*.smashbooking.com`), per-facility Razorpay, local testing and the verification checklist.

Short version: run migrations `0001`–`0006`, deploy the 4 Edge Functions, set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_ROOT_DOMAIN`, deploy to Vercel (`vercel.json` handles routing). **Test today on your existing `*.vercel.app` URL with `/f/<slug>` links.** Add `smashbooking.com` + `*.smashbooking.com` in Vercel when you own the domain, then set `VITE_WILDCARD_DOMAIN_READY=true`.

## Security model (summary)

- **Tenant isolation** is enforced by Postgres, not by the UI: every table has `facility_id`; RLS + `SECURITY DEFINER` RPCs check `facility_members`. Customers pass a *slug*; the facility is re-derived server-side and every court is verified to belong to it.
- **Roles:** player (any account) · facility owner (a `facility_members` row, created only by making a facility) · platform admin (explicit `platform_admins` row, only ever inserted by SQL). Registering grants no privilege.
- **Booking integrity:** a GiST exclusion constraint prevents overlapping court bookings; an order's court rows are written in one transaction (all-or-nothing); unpaid holds expire.
- **Payments:** each facility uses its **own** Razorpay account; secrets live in a table no browser role can read; a booking is confirmed only after server-side signature + Razorpay API verification (or a signed webhook).
- **Platform admin, facility status and slug changes** are only possible through admin RPCs; owners cannot edit their `slug`, `status`, `plan` or court limit.

## Project layout

```
supabase/migrations/   0001…0006 (0006 = multi-tenant, migrates existing data)
supabase/functions/    create-razorpay-order · verify-razorpay-payment · save-payment-config · razorpay-webhook
src/lib/tenant.js      hostname / path tenant resolution      src/lib/slug.js   name → subdomain
src/lib/api/           demo.js + supabase.js behind one `api`
src/pages/             facility (player) pages   src/pages/platform/ landing, owner auth, wizard, platform admin
src/pages/owner/       owner dashboard
tests/                 npm test → slug unit tests + SQL tests (in-process Postgres)
docs/DEPLOYMENT.md     deployment + verification checklist
```

## Not included / known limits
- No payment-screenshot upload, automatic refunds, emails or SMS. Owners refund from their own Razorpay dashboard.
- Razorpay secrets are stored as plain text behind service-role-only access (see hardening note in the deployment guide).
- Edge Functions and the real Razorpay/Supabase Auth paths could not be exercised without your credentials — test them with Razorpay **test keys** first.
