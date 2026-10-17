# Smash Court — badminton court booking

Mobile-first booking site for a facility with 3 courts. A booking is **any set of 30-minute slots (consecutive or not) on one or more courts**, paid online with **Razorpay**, and confirmed only after the payment is verified on the server.

**Stack:** React 19 + Vite, Tailwind CSS v4, React Router, Lucide, Supabase (Auth + Postgres + RLS + Edge Functions). Plain JavaScript/JSX.

## Run it (₹0, no setup) — demo mode

```bash
npm install
npm run dev        # http://localhost:5173
```

With no `.env.local` the app runs in **Demo mode** (amber banner on every page):
- Sample data kept only in the browser tab. "Reset demo" restores it.
- Login page → **Demo customer** / **Demo owner** (not secure, any password).
- Payment is a clearly-labelled **demo payment** — no gateway, no money, no emails/SMS.

## Booking rules
- Dates: today + next 13 days (14 total). 7-day strip, calendar icon for the rest. Past/out-of-window dates are disabled.
- Duration: choose 1, 2, 3 or 4 hours (needs *Max slots per booking* ≥ 8 — set to 8 by migration `0005`). Time slots are shown as 1-hour windows ("7:00–8:00 PM"); on phones they sit in one swipeable row, on desktop up to 6 per row. Past windows are hidden for today.
- Picking a start window auto-selects the following consecutive hours (2 Hours from 7:00 PM → 7–8 PM and 8–9 PM). Changing the duration or start re-syncs the selection. If any required hour is unavailable, runs past closing time, or no single court is free for the whole period, a clear message appears and **Confirm Booking** stays disabled.
- Pricing is still per 30-minute slot: price × slots × courts (e.g. ₹150 × 4 × 1 court = ₹600 for 2 hours).
- A sticky bottom bar shows the duration, From/To, selected courts and the total, live.
- "Pick your court" is always visible (swipeable cards on phones). The first free court (Court 1 → 2 → 3) is pre-selected; pick as many as you like (at least one is required). Each chosen court must be free for the **whole** period.
- Guests can browse and select freely. **Confirm Booking** asks them to log in with email + password only; after login, checkout uses the name and mobile already on the account and asks only for what's missing (email is never asked again; an Edit link is available). The selection is kept through login and email verification, and availability is re-checked.
- All selected courts are reserved **atomically**: if any one is taken, nothing is reserved. Unpaid holds expire after `hold_minutes` (default 15).
- The confirmation screen has a share icon (native share sheet, or copies the details + link).

## Connect Supabase
1. Create a free project at supabase.com.
2. SQL editor → run, in order: `supabase/migrations/0001_schema.sql`, `supabase/migrations/0002_orders_razorpay.sql`, `supabase/migrations/0003_multi_slot.sql`, `supabase/migrations/0004_segments.sql`, `supabase/migrations/0005_max_slots_8.sql`, `supabase/seed.sql`.
3. Auth → URL Configuration: add your site URL (`http://localhost:5173`, plus production) and the `/auth/reset` and `/continue` redirects (`/continue` is where the email-verification link lands and resumes a saved booking). Keep email confirmation on.
4. `.env.local` (copy `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
5. Sign up, verify email, then in SQL: `update public.profiles set role = 'owner' where email = 'you@example.com';`
6. Owner → Settings: name, address, hours, price per court.

> If you already ran `0001` with test data, `0002` migrates existing bookings into orders. `0002` removes the old manual-UPI functions; the `payment_submissions` table is left unused.

## Razorpay (online payment)
Until this is configured, payment is the demo flow (and in a real Supabase project it is **blocked** unless the owner ticks *Allow test payments* in Settings — keep that off in production).

1. Razorpay dashboard → API Keys (use **Test mode** first). Put the public **Key ID** in `.env.local`: `VITE_RAZORPAY_KEY_ID=rzp_test_xxx`.
2. Install the Supabase CLI, link the project, then set the secrets (never commit these):
   ```bash
   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxxx RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-string
   supabase functions deploy create-razorpay-order
   supabase functions deploy verify-razorpay-payment
   supabase functions deploy razorpay-webhook --no-verify-jwt
   ```
3. Razorpay → Webhooks → add `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured` and `order.paid`. This confirms bookings even if the customer closes the tab after paying.

**How payment is secured**
- The amount is read from the database on the server — never from the browser.
- After checkout, `verify-razorpay-payment` checks the HMAC signature **and** asks Razorpay's API that the payment is captured for that exact order/amount, then calls `finalize_order_payment` (callable only by the service role). Only then does the booking become *Confirmed*.
- A Razorpay payment id can settle only one order. Webhook + browser confirmation are idempotent.
- If someone pays after their hold expired and the courts were taken meanwhile, the order is flagged **Refund needed** in the owner dashboard (refund from Razorpay, then click "I've refunded this").
- Secrets live only in Supabase function secrets. Card/UPI details never touch this app.

## Database guarantees
- `bookings_no_overlap` exclusion constraint: a court can't have two active bookings overlapping, even under concurrent requests. An order's court rows are inserted in one transaction.
- Writes only through `SECURITY DEFINER` functions; direct table writes are revoked. RLS: customers read only their own orders; owner functions check `is_owner()` and write `audit_events`.
- Status machine enforced by trigger: `pending_payment → confirmed | cancelled | expired`, `confirmed → cancelled`.

## Owner dashboard (`/admin`)
Overview (today, awaiting payment, confirmed, verified online payments, slot usage, refunds needed), all bookings (filter/search; customer, courts, payment status, totals), manual bookings (multi-court), cancel / confirm-paid-at-venue with reason, court blocks, settings, activity log.

## Deploy
`npm run build` → deploy `dist/` (Netlify/Vercel/Cloudflare Pages). Set the `VITE_` env vars there; `public/_redirects` handles SPA routing on Netlify.

## Layout
```
supabase/migrations/        0001 schema · 0002 orders + Razorpay · 0003 multi-slot · 0004 separate time ranges · 0005 max 8 slots
supabase/functions/         create-razorpay-order · verify-razorpay-payment · razorpay-webhook
src/lib/api/                demo.js / supabase.js behind one `api`
src/pages/ , src/pages/admin/
```
