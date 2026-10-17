# Deployment guide — multi-tenant Smash Booking

One shared React app serves **everyone**: the platform (`smashbooking.com`), the owner dashboard, and every facility's booking site (`<slug>.smashbooking.com`). There is **no per-owner Vercel project and no per-owner deploy**. The browser decides which tenant to show from the hostname; the database decides whether that tenant is real, live and what it contains.

> Nothing here claims a subdomain is live. Until you finish sections 3–4, owners are shown a **working link** (`https://<your-site>/book/<slug>`) and the dashboard says the branded subdomain is *not connected yet*.

## 0. How tenant routing works

| URL | Mode | Result |
|---|---|---|
| `smashbooking.com`, `www.`, `app.` | platform | landing page, `/owner/*`, `/platform/*` |
| `smasharena.smashbooking.com` | host | Smash Arena's booking site |
| `smasharena.localhost:5173` | host | same, for local development (browsers resolve `*.localhost` to your machine) |
| `<any domain>/book/smasharena` | path | same site, **no DNS needed** — works today on `smash-booking-pink.vercel.app` |
| `<any domain>/?facility=smasharena` | dev shortcut | redirects to `/book/smasharena` |

The slug is only a lookup key. `get_facility_public(slug)` returns the facility only if it exists and is `active` (members/platform admins can also preview drafts). Booking RPCs take the **slug**, not an id, and re-derive the facility server-side; every court id is checked to belong to it. Unknown slugs get a clear "page doesn't exist" screen; pending/suspended facilities cannot accept bookings (enforced in the database, not just the UI).

`vercel.json` rewrites every path to `index.html` (single-page app), which is all Vercel needs — hostname handling happens in the app, so no middleware is required.

## 1. Supabase setup

1. Create a project (free tier is fine).
2. SQL editor → run, **in order**:
   `0001_schema.sql` → `0002_orders_razorpay.sql` → `0003_multi_slot.sql` → `0004_segments.sql` → `0005_max_slots_8.sql` → **`0006_multitenant.sql`** → (optional) `seed.sql` is no longer needed — facilities create their own courts.
   *Upgrading an existing deployment?* `0006` migrates your single facility into the new model as slug `smash-booking`, keeps all bookings, and turns former global owners into that facility's owner. **Nobody becomes a platform admin by migration.** Its Razorpay is **not** carried over — see section 5.
3. **Create the first platform administrator** (once, by you, after registering normally at `/owner/register`):
   ```sql
   insert into public.platform_admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
   Registering never grants admin rights; only this table does.
4. Authentication → **URL Configuration**
   - Site URL: `https://smashbooking.com` (or your Vercel URL while testing)
   - Redirect URLs (wildcards are supported):
     ```
     https://smashbooking.com/**
     https://*.smashbooking.com/**
     https://smash-booking-pink.vercel.app/**
     http://localhost:5173/**
     http://*.localhost:5173/**
     ```
   - Keep **Confirm email** ON. Owners return to `/owner/setup` after verifying; players return to `/continue` on their facility's site.
   - Note: browser sessions are per-origin, so a player logs in separately on each facility's subdomain, and owners log in on the primary domain. That separation is intentional.
5. Edge Functions (Supabase CLI: `npm i -g supabase`, `supabase login`, `supabase link --project-ref <ref>`):
   ```bash
   supabase functions deploy create-razorpay-order
   supabase functions deploy verify-razorpay-payment
   supabase functions deploy save-payment-config
   supabase functions deploy razorpay-webhook --no-verify-jwt
   ```
   **No global Razorpay secrets are needed any more** — `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. The service-role key never reaches the browser.

## 2. Environment variables

| Variable | Where | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel + `.env.local` | project URL |
| `VITE_SUPABASE_ANON_KEY` | Vercel + `.env.local` | **anon** key only |
| `VITE_ROOT_DOMAIN` | Vercel + `.env.local` | `smashbooking.com` |
| `VITE_WILDCARD_DOMAIN_READY` | Vercel | `false` until section 4 is done, then `true` |

Leave the Supabase variables empty to run in **demo mode** (local sample data, pretend payments).
`VITE_*` values are public by design. Never put the `service_role` key or any Razorpay secret in them.

## 3. Deploy to Vercel (existing project)

1. Push this branch to GitHub and import/redeploy the project (framework: Vite, build `npm run build`, output `dist` — also set in `vercel.json`).
2. Add the env vars above (Settings → Environment Variables) and redeploy.
3. **Test now, without the domain:** open `https://smash-booking-pink.vercel.app/` (platform) and `https://smash-booking-pink.vercel.app/book/<slug>` (a facility). The whole product works this way.

## 4. Connect `smashbooking.com` + wildcard subdomains

Only after you own the domain.

1. Vercel → project → **Settings → Domains → Add**: `smashbooking.com`, then `*.smashbooking.com`.
2. **Wildcard certificates need DNS-challenge access.** Vercel's current docs give two options:
   - **Recommended — Vercel nameservers.** Saving the wildcard domain enables Vercel DNS; set the registrar's nameservers to `ns1.vercel-dns.com` / `ns2.vercel-dns.com`. Before switching, copy your existing DNS records (MX/email, TXT) into Vercel DNS.
   - **Keep an external DNS provider.** Delegate certificate validation and route traffic:
     | Type | Name | Value |
     |---|---|---|
     | NS | `_acme-challenge` | `ns1.vercel-dns.com.` |
     | NS | `_acme-challenge` | `ns2.vercel-dns.com.` |
     | CNAME | `*` | `cname.vercel-dns-0.com.` |
     plus the records Vercel shows for the apex `smashbooking.com`. Keep the NS records so renewal works.
3. Wait until Vercel shows the domains as valid (HTTPS is issued automatically). Test `https://smasharena.smashbooking.com`.
4. Set `VITE_WILDCARD_DOMAIN_READY=true` and redeploy. Owners' dashboards now show the branded link.
5. Vercel's Hobby plan is for non-commercial use — a paid multi-tenant platform needs a plan that permits commercial use (check Vercel's terms). Hobby also caps custom domains per project.

**Reserved names** (`www`, `app`, `api`, `admin`, `owner`, `platform`, …) can never be claimed as facility addresses (table `reserved_slugs`).

## 5. Payments (per facility)

Each facility connects **its own** Razorpay account in *Owner dashboard → Payments* (the wizard offers it too). The key secret goes to the `save-payment-config` Edge Function, which validates it with Razorpay and stores it in `facility_payment_config` — a table no browser role (anon/authenticated) can read. Orders always use the credentials of the **order's own facility**, so one facility's customers can never pay into another's account, and a facility's webhook can only settle that facility's orders.

Per facility, in its Razorpay dashboard add the webhook shown in the Payments page:
`https://<project>.supabase.co/functions/v1/razorpay-webhook?facility=<facility id>`, events `payment.captured` and `order.paid`, with the same webhook secret entered in the dashboard.

Security hardening you may want later: the key secrets are stored as plain text protected by access control (service role only). For stronger protection store them with Supabase Vault / pgsodium encryption.

Without credentials a facility can use **test payments** (owner-enabled toggle) — clearly labelled, confirms bookings without charging. Leave it off in production.

## 6. Local development

```bash
npm install
npm run dev                       # http://localhost:5173
```
- Platform: `http://localhost:5173/`
- A facility, three ways: `http://localhost:5173/book/smasharena` · `http://smasharena.localhost:5173/` · `http://localhost:5173/?facility=smasharena`
- Demo logins: `/owner/login` has **Demo owner** and **Demo platform admin**; facility sites have "Continue as demo player".
- Demo data is stored in `localStorage` for the origin and shared across tabs; `smasharena.localhost` is a different origin with its own demo data. "Reset demo" restores the samples.

Tests (no Supabase needed): `npm test` runs the slug unit tests and ~85 SQL checks against the real migrations in an in-process Postgres (PGlite): upgrade path, tenant isolation, role boundaries, atomic booking.

## 7. Verification checklist

**Owner isolation**
- [ ] Owner A cannot see/cancel/refund Owner B's bookings, edit B's facility, add courts to B, or block B's courts (tests cover this; try it with two real accounts).
- [ ] Owner A's dashboard shows only A's bookings, payments, audit log.
- [ ] A registered owner opening `/platform` sees "Platform administrators only".
- [ ] `select * from facility_payment_config` as a logged-in user fails (permission denied).

**Subdomain routing**
- [ ] `/book/<slug>` (and the older `/f/<slug>`) shows only that facility's name, courts, prices, hours, durations.
- [ ] Unknown slug → "This booking page doesn't exist". Pending → "isn't live yet". Suspended → "Bookings are paused".
- [ ] After section 4: `https://<slug>.smashbooking.com` and `https://www.smashbooking.com` behave as described; `/owner` on a facility subdomain is *not* the dashboard.
- [ ] Duplicate / reserved / invalid addresses are refused in the wizard.
- [ ] Only a platform admin can change an address (Platform → Facilities → Address).

**Booking availability**
- [ ] Two browsers cannot book the same court/time (second gets "just taken", nothing partial is saved).
- [ ] The same time on another facility is unaffected.
- [ ] Weekly days off and holidays are greyed out; offered durations match the owner's settings.
- [ ] A suspended or unpublished facility rejects bookings even via a direct API call.

**Payment security**
- [ ] A booking only becomes *Confirmed* after `verify-razorpay-payment` (signature **and** Razorpay API check) or the webhook; a forged client call cannot confirm.
- [ ] A Razorpay payment id can settle only one order; amounts come from the database.
- [ ] Facility B's customers' payments use B's Razorpay account (check the order in B's Razorpay dashboard).
- [ ] With no Razorpay connected and test payments off, players see "payment not set up" and cannot confirm.
- [ ] No secret appears in browser DevTools → Network/Storage (only the public `rzp_…` key id is returned).
