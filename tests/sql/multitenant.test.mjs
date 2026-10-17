// Multi-tenant database tests: upgrade path, tenant isolation, role boundaries, booking integrity.
// Run with:  npm run test:sql   (uses an in-process Postgres — no Supabase account needed)
import { makeDb, seedUser, as, expectError } from './harness.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
let fails = 0
const ok = (c, m) => { console.log(c === true ? '  ✓' : '  ✗ FAIL', m, c === true ? '' : `→ ${c}`); if (c !== true) fails++ }
const seedSql = readFileSync(fileURLToPath(new URL('../../supabase/seed.sql', import.meta.url)), 'utf8').split('\n').filter((l) => !l.startsWith('--')).join('\n')
const MIG = fileURLToPath(new URL('../../supabase/migrations/0006_multitenant.sql', import.meta.url))

// ------------------------------------------------------------------ A. upgrade path
console.log('A. Upgrading an existing single-facility database')
{
  const db = await makeDb({ upTo: 5 })
  await db.exec(seedSql)
  const oldOwner = await seedUser(db, 'old-owner@x.com')
  const player = await seedUser(db, 'player@x.com')
  await db.exec(`update profiles set role='owner' where id='${oldOwner}'`)
  const courts = (await db.query('select id from courts order by number')).rows
  const o = await as(db, player, () => db.query("select * from create_order($1::uuid[], current_date+1, '[{\"start\":\"10:00\",\"end\":\"11:00\"}]'::jsonb, 'Pat', '9876543210')", [[courts[0].id]]))
  await db.exec(readFileSync(MIG, 'utf8'))
  const f = (await db.query("select * from facilities")).rows
  ok(f.length === 1 && f[0].slug === 'smash-booking' && f[0].status === 'active', 'legacy facility migrated → slug smash-booking, active')
  ok((await db.query('select count(*)::int n from courts where facility_id = $1', [f[0].id])).rows[0].n === 3, 'its 3 courts carried over')
  ok((await db.query('select facility_id from orders where id=$1', [o.rows[0].id])).rows[0].facility_id === f[0].id, 'existing order tagged with the facility')
  ok((await db.query('select count(*)::int n from bookings where facility_id=$1', [f[0].id])).rows[0].n === 1, 'existing booking rows tagged')
  ok((await db.query('select 1 from facility_members where user_id=$1 and facility_id=$2 and role=$3', [oldOwner, f[0].id, 'owner'])).rows.length === 1, 'former global owner is now a facility owner')
  ok((await db.query('select count(*)::int n from platform_admins')).rows[0].n === 0, 'NOBODY became a platform admin by migration')
  ok((await as(db, player, () => db.query('select count(*)::int n from orders'))).rows[0].n === 1, 'player still sees own order after migration')
}

// ------------------------------------------------------------------ B. fresh multi-tenant
const db = await makeDb({ upTo: 6 })
const ownerA = await seedUser(db, 'a@x.com', { full_name: 'Alice Owner', phone: '9000000001' })
const ownerB = await seedUser(db, 'b@x.com')
const ownerC = await seedUser(db, 'c@x.com')
const alice = await seedUser(db, 'alice@x.com')
const bob = await seedUser(db, 'bob@x.com')
const root = await seedUser(db, 'root@x.com')
const wiz = (slug, name, courts = 3, extra = {}) => ({
  name, slug, city: 'Chennai', address: '1 Main Road', contact_phone: '9876543210',
  opening_time: '06:00', closing_time: '22:00', available_durations: [1, 2, 3, 4], price_per_hour: 300,
  courts: Array.from({ length: courts }, (_, i) => ({ name: `Court ${i + 1}` })), ...extra,
})
const call = (uid, sql, params = []) => as(db, uid, () => db.query(sql, params))
const create = (uid, p) => call(uid, 'select * from create_facility($1::jsonb)', [JSON.stringify(p)])

console.log('B1. Owner registration + setup wizard')
const fa = (await create(ownerA, wiz('smasharena', 'Smash Arena', 3))).rows[0]
const fb = (await create(ownerB, wiz('greenshuttle', 'Green Shuttle Club', 2, { closing_time: '23:00' }))).rows[0]
ok(fa.status === 'active' && fa.price_per_slot == 150 && fa.max_slots_per_booking === 8, 'facility A created, active, ₹300/hr → ₹150 per 30-min slot')
ok((await call(ownerA, 'select count(*)::int n from courts where facility_id=$1', [fa.id])).rows[0].n === 3, 'owner A sees their 3 courts')
ok(await expectError(create(ownerA, wiz('second-one', 'Second', 1)), /facility_limit_reached/), 'owner A cannot create a second facility (plan limit)')
ok(await expectError(create(ownerC, wiz('smasharena', 'Copycat')), /slug_taken/), 'duplicate subdomain → slug_taken')
ok(await expectError(create(ownerC, wiz('www', 'WWW')), /slug_reserved/), 'reserved subdomain → slug_reserved')
ok(await expectError(create(ownerC, wiz('Bad Slug!', 'Bad')), /invalid_slug/), 'invalid slug rejected')
ok(await expectError(create(ownerC, wiz('ok-name', 'Ok', 1, { available_durations: [5] })), /invalid_durations/), 'invalid durations rejected')
ok(await expectError(create(ownerC, wiz('ok-name', 'Ok', 99)), /court_limit_reached/), 'too many courts for the plan rejected')
ok(await expectError(create(ownerC, wiz('ok-name', 'Ok', 1, { opening_time: '22:00', closing_time: '06:00' })), /invalid_hours/), 'closing before opening rejected')
ok(await expectError(as(db, 'anon', () => db.query('select * from create_facility($1::jsonb)', [JSON.stringify(wiz('anon-fac', 'Anon'))])), /permission denied|not_authenticated/), 'anonymous cannot create a facility')
const slugs = (await call(ownerC, "select * from check_slugs(array['smasharena','greenshuttle-chennai','www','Not Valid'])")).rows
const m = Object.fromEntries(slugs.map((r) => [r.slug, r]))
ok(m.smasharena.available === false && m.smasharena.reason === 'taken' && m['greenshuttle-chennai'].available === true && m.www.reason === 'reserved', 'check_slugs reports taken / available / reserved')
ok(await expectError(create(ownerA, wiz('x', 'x')), /./), 'a second attempt by A stays blocked')

console.log('B2. Tenant resolution (public)')
const pub = (await as(db, 'anon', () => db.query("select get_facility_public('smasharena') j"))).rows[0].j
ok(pub.state === 'live' && pub.facility.name === 'Smash Arena' && pub.courts.length === 3, 'anon resolves smasharena → live, 3 courts')
ok(!('created_by' in pub.facility) && !('suspended_reason' in pub.facility), 'public payload exposes no internal fields')
ok((await as(db, 'anon', () => db.query("select get_facility_public('unknown-slug') j"))).rows[0].j.state === 'not_found', 'unknown subdomain → not_found')
ok((await as(db, 'anon', () => db.query("select count(*)::int n from list_public_facilities()"))).rows[0].n === 2, 'directory lists both active facilities')
ok(await as(db, 'anon', async () => { try { await db.query('select * from facilities'); return 'anon read facilities table' } catch { return true } }), 'anon cannot read the facilities table directly')
ok(await as(db, 'anon', async () => { try { await db.query('select * from courts'); return 'anon read courts table' } catch { return true } }), 'anon cannot read the courts table directly')

console.log('B3. Booking isolation + double-booking prevention')
const courtsA = (await call(ownerA, 'select id from courts where facility_id=$1 order by number', [fa.id])).rows.map((r) => r.id)
const courtsB = (await call(ownerB, 'select id from courts where facility_id=$1 order by number', [fb.id])).rows.map((r) => r.id)
const seg = (a = '10:00', b = '11:00') => JSON.stringify([{ start: a, end: b }])
const book = (uid, slug, ids, s = seg()) => call(uid, "select * from create_order($1, $2::uuid[], current_date+1, $3::jsonb, 'Pat Player', '9876543210')", [slug, ids, s])
const oa = (await book(alice, 'smasharena', [courtsA[0], courtsA[1]])).rows[0]
ok(oa.facility_id === fa.id && oa.total_amount == 600, 'alice books A courts 1+2 for 1 hr → ₹600, order tagged with facility A')
ok(await expectError(book(bob, 'smasharena', [courtsA[1], courtsA[2]]), /slot_unavailable/), 'bob overlapping on court 2 → slot_unavailable')
ok((await db.query('select count(*)::int n from bookings where facility_id=$1', [fa.id])).rows[0].n === 2, 'no partial reservation')
ok((await book(bob, 'greenshuttle', [courtsB[0]])).rows.length === 1, 'same time on facility B is unaffected (isolation)')
ok(await expectError(book(bob, 'greenshuttle', [courtsA[2]]), /court_unavailable/), "cannot book facility A's court through facility B's subdomain")
ok(await expectError(book(bob, 'smasharena', [courtsB[1]]), /court_unavailable/), "cannot book facility B's court through facility A's subdomain")
ok(await expectError(book(bob, 'nope', [courtsA[2]]), /facility_not_found/), 'unknown slug cannot receive bookings')
ok(await expectError(book(bob, 'smasharena', [courtsA[2]], seg('10:00', '10:30')), /invalid_duration/), 'half-hour booking rejected (only whole-hour durations)')
ok(await expectError(book(bob, 'smasharena', [courtsA[2]], seg('10:00', '15:00')), /too_many_slots|invalid_duration/), '5-hour booking rejected')
const busyA = (await as(db, 'anon', () => db.query("select * from get_busy_slots('smasharena', current_date+1)"))).rows
const busyB = (await as(db, 'anon', () => db.query("select * from get_busy_slots('greenshuttle', current_date+1)"))).rows
ok(busyA.length === 2 && busyB.length === 1 && busyA.every((r) => courtsA.includes(r.court_id)), 'availability is per facility (A: 2 rows, B: 1 row)')
const oOwnerA = await call(ownerA, 'select count(*)::int n from orders'); const oOwnerB = await call(ownerB, 'select count(*)::int n from orders')
ok(oOwnerA.rows[0].n === 1 && oOwnerB.rows[0].n === 1, 'each owner sees only their own facility’s orders (RLS)')
ok((await call(alice, 'select count(*)::int n from orders')).rows[0].n === 1, 'player sees only their own orders')
ok((await call(ownerA, 'select count(*)::int n from bookings')).rows[0].n === 2, 'owner A sees only A court rows')

console.log('B4. Cross-tenant owner actions are forbidden')
const ordB = (await call(ownerB, 'select id from orders')).rows[0].id
ok(await expectError(call(ownerA, "select * from admin_set_order_status($1,'cancelled','trying')", [ordB]), /forbidden/), "owner A cannot cancel owner B's order")
ok(await expectError(call(ownerA, "select * from admin_mark_refunded($1)", [ordB]), /forbidden/), "owner A cannot refund owner B's order")
ok(await expectError(call(ownerA, "select * from update_facility($1, '{\"name\":\"Hacked\"}'::jsonb)", [fb.id]), /forbidden/), "owner A cannot edit facility B")
ok(await expectError(call(ownerA, "select * from admin_create_order($1, $2::uuid[], current_date+2, $3::jsonb, 'x y', '9876543210')", [fb.id, [courtsB[0]], seg()]), /forbidden/), 'owner A cannot create bookings for facility B')
ok(await expectError(call(ownerA, "select * from admin_create_block($1, current_date+1, '10:00', '11:00', 'x')", [courtsB[0]]), /forbidden/), 'owner A cannot block facility B courts')
ok(await expectError(call(alice, "select * from admin_set_order_status($1,'cancelled','trying')", [oa.id]), /forbidden/), 'a player cannot use owner RPCs even on their own order')
ok(await call(ownerA, "insert into courts (facility_id, name) values ($1, 'Sneaky')", [fb.id]).then(() => 'inserted into other facility', () => true), 'owner A cannot add a court to facility B (RLS)')
ok((await call(ownerA, "update courts set name='Hacked' where facility_id=$1", [fb.id])).affectedRows === 0, 'owner A cannot rename facility B courts (0 rows)')
ok(await call(ownerA, "update courts set facility_id=$1 where id=$2", [fb.id, courtsA[0]]).then(() => 'moved court to other facility', () => true), 'owners cannot move a court between facilities')
ok(await call(ownerA, "update facilities set slug='hijack' where id=$1", [fa.id]).then(() => 'direct update allowed', () => true), 'owners cannot UPDATE facilities directly (slug protected)')
const upd = (await call(ownerA, "select * from update_facility($1, '{\"slug\":\"hijack\",\"status\":\"suspended\",\"max_courts\":50,\"name\":\"Smash Arena Pro\",\"price_per_hour\":400}'::jsonb)", [fa.id])).rows[0]
ok(upd.slug === 'smasharena' && upd.status === 'active' && upd.max_courts === 6 && upd.name === 'Smash Arena Pro' && upd.price_per_slot == 200, 'update_facility ignores slug/status/max_courts, applies name & price')
ok(await call(ownerA, 'select * from facility_payment_config').then(() => 'owner read payment credentials', () => true), 'owners cannot read payment credentials table')
ok(await as(db, 'anon', () => db.query('select * from facility_payment_config')).then(() => 'anon read payment credentials', () => true), 'anon cannot read payment credentials table')

console.log('B5. Court management & limits')
for (let i = 4; i <= 6; i++) await call(ownerA, "insert into courts (facility_id, name) values ($1, $2)", [fa.id, `Court ${i}`])
ok((await call(ownerA, 'select count(*)::int n from courts where facility_id=$1', [fa.id])).rows[0].n === 6, 'owner A adds courts up to the plan limit (6)')
ok(await expectError(call(ownerA, "insert into courts (facility_id, name) values ($1, 'Court 7')", [fa.id]), /court_limit_reached/), 'a 7th court is refused')
ok(await expectError(call(ownerA, 'delete from courts where id=$1', [courtsA[0]]), /./), 'a court with bookings cannot be deleted (deactivate instead)')
await call(ownerA, 'update courts set is_active=false where id=$1', [courtsA[2]])
ok(await expectError(book(bob, 'smasharena', [courtsA[2]], seg('12:00', '13:00')), /court_unavailable/), 'deactivated court cannot be booked')

console.log('B6. Closed days, durations, payments')
const courtsA6 = (await call(ownerA, 'select id from courts where facility_id=$1 order by number', [fa.id])).rows.map((r) => r.id)
const dow = (await db.query("select extract(dow from current_date+3)::int d, (current_date+4)::text h")).rows[0]
await call(ownerA, "select update_facility($1, $2::jsonb)", [fa.id, JSON.stringify({ closed_weekdays: [dow.d], holidays: [dow.h], available_durations: [1, 2] })])
const book3 = (uid, slug, ids, offset, s) => call(uid, "select * from create_order($1, $2::uuid[], current_date+$3::int, $4::jsonb, 'Pat Player', '9876543210')", [slug, ids, offset, s])
ok(await expectError(book3(bob, 'smasharena', [courtsA6[3]], 3, seg()), /facility_closed_that_day/), 'weekly closed day enforced')
ok(await expectError(book3(bob, 'smasharena', [courtsA6[3]], 4, seg()), /facility_closed_that_day/), 'holiday enforced')
ok(await expectError(book3(bob, 'smasharena', [courtsA6[3]], 2, seg('10:00', '13:00')), /invalid_duration/), '3 hours refused when the owner only offers 1–2 hours')
ok((await book3(bob, 'smasharena', [courtsA6[3]], 2, seg('10:00', '12:00'))).rows.length === 1, '2 hours accepted')
const oDemo = (await book3(alice, 'smasharena', [courtsA6[4]], 2, seg('10:00', '11:00'))).rows[0]
ok(await expectError(call(alice, 'select * from demo_pay_order($1)', [oDemo.id]), /demo_payments_disabled/), 'demo payment OFF by default')
await call(ownerA, "select update_facility($1, '{\"allow_demo_payments\":true}'::jsonb)", [fa.id])
await db.exec(`update facilities set payment_mode='razorpay', razorpay_key_id='rzp_test_abc123' where id='${fa.id}'`)
ok(await expectError(call(alice, 'select * from demo_pay_order($1)', [oDemo.id]), /demo_payments_disabled/), 'demo payment refused once real payments are configured')
await db.exec(`update facilities set payment_mode='none' where id='${fa.id}'`)
ok((await call(alice, 'select * from demo_pay_order($1)', [oDemo.id])).rows[0].payment_status === 'demo', 'owner-enabled test payment works when Razorpay is not configured')
// razorpay settlement: facility-bound
await db.exec(`update orders set razorpay_order_id='order_X' where id='${oa.id}'`)
ok(await as(db, alice, () => db.query("select finalize_order_payment($1,'order_X','pay_1',600)", [oa.id])).then(() => 'player finalized a payment', () => true), 'players cannot settle payments')
ok((await as(db, 'service', () => db.query("select * from finalize_order_payment($1,'order_X','pay_1',600)", [oa.id]))).rows[0].payment_status === 'paid', 'service role settles a verified payment')
ok(await expectError(as(db, 'service', () => db.query("select * from finalize_order_payment($1,'order_Y','pay_9',600)", [oa.id])), /razorpay_order_mismatch|already_paid/), 'a payment for a different Razorpay order cannot settle it')

console.log('B7. Platform administration')
ok((await call(ownerA, 'select is_platform_admin() a')).rows[0].a === false, 'a registered owner is NOT a platform admin')
ok(await expectError(call(ownerA, 'select * from platform_list_facilities()'), /forbidden/), 'owner cannot list all facilities')
ok(await expectError(call(ownerA, "select * from platform_set_facility_status($1,'suspended','x y z')", [fb.id]), /forbidden/), 'owner cannot suspend another facility')
ok(await expectError(call(ownerA, 'select * from platform_metrics()'), /forbidden/), 'owner cannot read platform metrics')
ok(await expectError(call(alice, "select * from platform_set_setting('require_facility_approval','true'::jsonb)"), /forbidden/), 'player cannot change platform settings')
ok(await call(alice, "insert into platform_admins (user_id) values ($1)", [alice]).then(() => 'self-granted admin', () => true), 'nobody can grant themselves platform admin')
await db.exec(`insert into platform_admins (user_id) values ('${root}')`)
ok((await call(root, 'select is_platform_admin() a')).rows[0].a === true, 'explicitly allow-listed user is a platform admin')
const list = (await call(root, 'select * from platform_list_facilities()')).rows
ok(list.length === 2 && list.find((x) => x.slug === 'smasharena').owner_email === 'a@x.com', 'admin sees all facilities with owner emails')
ok((await call(root, 'select * from platform_metrics()')).rows[0].platform_metrics.facilities === 2, 'admin sees platform metrics')
await call(root, "select * from platform_set_facility_status($1,'suspended','Policy violation')", [fb.id])
ok((await as(db, 'anon', () => db.query("select get_facility_public('greenshuttle') j"))).rows[0].j.state === 'suspended', 'suspended facility → public state "suspended"')
ok(await expectError(book(bob, 'greenshuttle', [courtsB[1]], seg('14:00', '15:00')), /facility_not_active/), 'suspended facility cannot accept bookings')
ok((await call(ownerB, "select get_facility_public('greenshuttle') j")).rows[0].j.state === 'preview', 'its owner can still preview the page')
ok((await as(db, 'anon', () => db.query("select count(*)::int n from list_public_facilities()"))).rows[0].n === 1, 'suspended facility leaves the public directory')
await call(root, "select * from platform_set_facility_status($1,'active')", [fb.id])
ok((await book(bob, 'greenshuttle', [courtsB[1]], seg('14:00', '15:00'))).rows.length === 1, 'reactivated facility accepts bookings again')
ok(await expectError(call(root, "select * from platform_set_slug($1,'smasharena')", [fb.id]), /slug_taken/), 'admin cannot assign a duplicate slug')
ok((await call(root, "select * from platform_set_slug($1,'green-shuttle')", [fb.id])).rows[0].slug === 'green-shuttle', 'admin can rename a slug')
await call(root, "select platform_set_setting('require_facility_approval','true'::jsonb)")
const fc = (await create(ownerC, wiz('newplace', 'New Place', 1))).rows[0]
ok(fc.status === 'pending', 'with approval required, a new facility starts as pending')
ok(await expectError(book(bob, 'newplace', [(await call(ownerC, 'select id from courts')).rows[0].id]), /facility_not_active/), 'pending facility cannot take bookings')
ok((await as(db, 'anon', () => db.query("select get_facility_public('newplace') j"))).rows[0].j.state === 'not_live', 'pending facility is "not_live" to the public')
const audit = (await call(root, 'select count(*)::int n from audit_events')).rows[0].n
ok(audit > 5, `audit trail recorded (${audit} events)`)
ok((await call(ownerA, 'select count(*)::int n from audit_events')).rows[0].n > 0 && (await call(ownerA, 'select count(*)::int n from audit_events where facility_id <> $1', [fa.id])).rows[0].n === 0, 'owner sees only their own facility audit events')

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL SQL CHECKS PASSED')
process.exit(fails ? 1 : 0)
