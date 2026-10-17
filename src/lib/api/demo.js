// DEMO backend: a local, in-memory MULTI-TENANT mock (mirrored to localStorage so new tabs — e.g. "Preview booking page" —
// see the same demo data; state is re-read before every call so tabs don't overwrite each other).
// - No network, no real accounts, no real payments, no emails/SMS. Demo login accepts any password.
// - Rules mirror supabase/migrations so behaviour matches the real backend.
// - Storage is per-origin: a facility created on localhost is reachable at /book/<slug> on the same
//   origin, but NOT at <slug>.localhost (a different origin has its own demo data).
import { addDays, bookingSegments, toMin, todayISO, nowMinutes } from '../time.js'
import { TRANSITIONS, ACTIVE_STATUSES } from '../status.js'
import { TENANT } from '../tenant.js'
import { SLUG_RE } from '../slug.js'

const KEY = 'badminton-demo-v6'
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms))
const uid = () => crypto.randomUUID()
const fail = (code) => {
  throw new Error(code)
}
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'owner', 'owners', 'platform', 'mail', 'smtp', 'ftp', 'dashboard', 'auth', 'login', 'register', 'signup', 'support', 'help', 'status', 'blog', 'docs', 'static', 'assets', 'cdn', 'dev', 'test', 'staging', 'smashbooking', 'smash', 'booking', 'bookings', 'localhost', 'vercel', 'supabase', 'root', 'null', 'undefined', 'f'])
const clone = (x) => JSON.parse(JSON.stringify(x))

function newFacility(over) {
  return {
    id: uid(), slug: '', name: '', tagline: 'Your Court. Your Game.', logoUrl: '', address: '', city: '', contactPhone: '', contactEmail: '',
    status: 'active', suspendedReason: null, plan: 'free', maxCourts: 6, openingTime: '06:00', closingTime: '22:00', slotMinutes: 30,
    pricePerSlot: 150, maxSlotsPerBooking: 8, maxUnpaidHolds: 2, holdMinutes: 15, advanceBookingDays: 14, timezone: 'Asia/Kolkata',
    cancellationPolicy: 'Contact the facility to cancel a confirmed booking. Refund terms are set by the owner.',
    availableDurations: [1, 2, 3, 4], closedWeekdays: [], holidays: [], allowDemoPayments: true, paymentMode: 'none', razorpayKeyId: null,
    createdBy: null, createdAt: new Date().toISOString(), ...over,
  }
}

function seed() {
  const today = todayISO('Asia/Kolkata')
  const now = new Date().toISOString()
  const users = {
    'demo-customer': { id: 'demo-customer', email: 'player@demo.local', name: 'Demo Player', phone: '9000000001' },
    'demo-owner': { id: 'demo-owner', email: 'owner@demo.local', name: 'Demo Owner', phone: '9000000003' },
    'demo-owner2': { id: 'demo-owner2', email: 'owner2@demo.local', name: 'Second Owner', phone: '9000000004' },
    'demo-admin': { id: 'demo-admin', email: 'admin@demo.local', name: 'Platform Admin', phone: '' },
  }
  const f1 = newFacility({ id: 'fac-smasharena', slug: 'smasharena', name: 'Smash Arena', city: 'Chennai', address: '12 Demo Street, Chennai (sample address)', contactPhone: '9000000010', contactEmail: 'hello@smasharena.demo', createdBy: 'demo-owner' })
  const f2 = newFacility({ id: 'fac-greenshuttle', slug: 'greenshuttle', name: 'Green Shuttle Club', city: 'Bengaluru', tagline: 'Play. Smash. Repeat.', address: '34 Sample Road, Bengaluru (sample address)', openingTime: '07:00', closingTime: '23:00', pricePerSlot: 200, closedWeekdays: [0], createdBy: 'demo-owner2' })
  const courts = [
    ...[1, 2, 3].map((n) => ({ id: `${f1.id}-c${n}`, facilityId: f1.id, number: n, name: `Court ${n}`, imageUrl: '', isActive: true })),
    ...[1, 2].map((n) => ({ id: `${f2.id}-c${n}`, facilityId: f2.id, number: n, name: `Court ${n}`, imageUrl: '', isActive: true })),
  ]
  const mk = (over) => {
    const o = {
      id: uid(), facilityId: f1.id, reference: 'BK-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      userId: 'demo-other', courtIds: [`${f1.id}-c1`], date: today, start: '18:00', end: '19:00',
      customerName: 'Sample Player', customerPhone: '9000000002', customerEmail: 'sample@demo.local',
      totalAmount: 300, status: 'confirmed', paymentStatus: 'demo', paymentMethod: 'demo',
      paidAt: now, needsRefund: false, expiresAt: null, confirmedAt: now, cancelledAt: null,
      cancellationReason: null, createdByAdmin: false, adminNote: null, createdAt: now, ...over,
    }
    return { ...o, segments: o.segments || [{ start: o.start, end: o.end }] }
  }
  const mine = { userId: 'demo-customer', customerName: 'Demo Player', customerPhone: '9000000001', customerEmail: 'player@demo.local' }
  const bookings = [
    mk({ courtIds: [`${f1.id}-c1`, `${f1.id}-c2`], start: '18:00', end: '19:00', totalAmount: 600, customerName: 'Aarav (sample)' }),
    mk({ courtIds: [`${f1.id}-c3`], date: addDays(today, 1), start: '07:00', end: '08:00', customerName: 'Kabir (sample)', status: 'pending_payment', paymentStatus: 'unpaid', paymentMethod: null, paidAt: null, confirmedAt: null, expiresAt: new Date(Date.now() + 10 * 60000).toISOString() }),
    mk({ ...mine, courtIds: [`${f1.id}-c1`], date: addDays(today, -2), start: '17:00', end: '18:00' }),
    mk({ ...mine, courtIds: [`${f1.id}-c2`, `${f1.id}-c3`], date: addDays(today, 3), start: '20:00', end: '21:00', totalAmount: 600 }),
    mk({ ...mine, courtIds: [`${f1.id}-c3`], date: addDays(today, 5), start: '10:00', end: '11:00', status: 'cancelled', paymentStatus: 'unpaid', paymentMethod: null, paidAt: null, confirmedAt: null, cancelledAt: now, cancellationReason: 'Cancelled by customer' }),
    mk({ facilityId: f2.id, courtIds: [`${f2.id}-c1`], date: addDays(today, 1), start: '19:00', end: '20:00', totalAmount: 400, customerName: 'Meera (sample)' }),
  ]
  const blocks = [{ id: uid(), facilityId: f1.id, courtId: `${f1.id}-c3`, date: today, start: '12:00', end: '14:00', reason: 'Net replacement (sample)', createdAt: now }]
  return {
    users, sessionUserId: null, facilities: [f1, f2], courts, bookings, blocks, audit: [],
    members: [{ facilityId: f1.id, userId: 'demo-owner', role: 'owner' }, { facilityId: f2.id, userId: 'demo-owner2', role: 'owner' }],
    platformAdmins: ['demo-admin'],
    platformSettings: { require_facility_approval: false, max_facilities_per_owner: 1, max_courts_per_facility: 6 },
  }
}

let db = load() || seed()
function load() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* storage unavailable — demo still works in memory */
  }
}
const listeners = new Set()
const emit = () => listeners.forEach((cb) => cb(currentUser()))
const currentUser = () => {
  const u = db.sessionUserId ? db.users[db.sessionUserId] : null
  return u ? { ...u, isPlatformAdmin: db.platformAdmins.includes(u.id) } : null
}
const requireUser = () => currentUser() || fail('not_authenticated')
const facilityById = (id) => db.facilities.find((f) => f.id === id)
const isMember = (fid, uid_ = db.sessionUserId) => db.members.some((m) => m.facilityId === fid && m.userId === uid_)
const requireMember = (fid) => {
  requireUser()
  if (!fid || !isMember(fid)) fail('forbidden')
}
const requirePlatformAdmin = () => {
  if (!currentUser()?.isPlatformAdmin) fail('forbidden')
}
const withCourt = (b) => ({
  ...clone(b),
  courtNumbers: b.courtIds.map((id) => db.courts.find((c) => c.id === id)?.number).filter(Boolean).sort((x, y) => x - y),
})
const publicFacility = (f) => clone(f)

function expireStale() {
  const now = Date.now()
  for (const b of db.bookings) {
    if (b.status === 'pending_payment' && b.expiresAt && new Date(b.expiresAt).getTime() < now) b.status = 'expired'
  }
}
function transition(b, to) {
  if (b.status !== to && !TRANSITIONS[b.status].includes(to)) fail('invalid_status_transition')
  b.status = to
}
function audit(facilityId, action, entity, details) {
  const u = currentUser()
  db.audit.unshift({ id: uid(), facilityId, actorEmail: u?.email, action, entityType: entity, details, createdAt: new Date().toISOString() })
}
const overlaps = (aS, aE, bS, bE) => toMin(aS) < toMin(bE) && toMin(aE) > toMin(bS)
const cleanPhone = (p) => String(p || '').replace(/\D/g, '')
function checkContact(name, phone) {
  if (String(name || '').trim().length < 2) fail('invalid_name')
  if (!/^\d{10,15}$/.test(cleanPhone(phone))) fail('invalid_phone')
}

function createCore({ facility: f, userId, courtIds, date, segments, name, phone, email, status, byAdmin, note }) {
  if (!byAdmin && f.status !== 'active') fail('facility_not_active')
  const ids = [...new Set(courtIds || [])]
  if (!ids.length) fail('no_courts_selected')
  // every court must belong to THIS facility and be active
  if (ids.some((id) => !db.courts.find((c) => c.id === id && c.isActive && c.facilityId === f.id))) fail('court_unavailable')
  const segs = [...(segments || [])].sort((a, b) => toMin(a.start) - toMin(b.start))
  if (!segs.length) fail('invalid_slot')
  const dow = new Date(`${date}T00:00:00`).getDay()
  if (!byAdmin && (f.closedWeekdays.includes(dow) || f.holidays.includes(date))) fail('facility_closed_that_day')
  let slots = 0
  segs.forEach((g, i) => {
    if (toMin(g.end) <= toMin(g.start)) fail('invalid_time_range')
    if (toMin(g.start) < toMin(f.openingTime) || toMin(g.end) > toMin(f.closingTime)) fail('outside_operating_hours')
    const mins = toMin(g.end) - toMin(g.start)
    if (mins % f.slotMinutes !== 0 || (toMin(g.start) - toMin(f.openingTime)) % f.slotMinutes !== 0) fail('invalid_slot')
    if (i && toMin(g.start) < toMin(segs[i - 1].end)) fail('invalid_slot')
    slots += mins / f.slotMinutes
  })
  const today = todayISO(f.timezone)
  if (!byAdmin) {
    const hours = (slots * f.slotMinutes) / 60
    if (!Number.isInteger(hours) || !f.availableDurations.includes(hours)) fail('invalid_duration')
  }
  if (slots > f.maxSlotsPerBooking) fail('too_many_slots')
  if (!byAdmin) {
    if (date < today || (date === today && toMin(segs[0].start) <= nowMinutes(f.timezone))) fail('slot_in_past')
    if (date > addDays(today, f.advanceBookingDays - 1)) fail('too_far_ahead')
  }
  expireStale()
  // All-or-nothing: every court x segment is checked BEFORE anything is written.
  for (const id of ids) {
    for (const g of segs) {
      if (db.blocks.some((k) => k.courtId === id && k.date === date && overlaps(k.start, k.end, g.start, g.end))) fail('slot_blocked')
      if (db.bookings.some((b) => b.courtIds.includes(id) && b.date === date && ACTIVE_STATUSES.includes(b.status)
        && bookingSegments(b).some((o) => overlaps(o.start, o.end, g.start, g.end)))) fail('slot_unavailable')
    }
  }
  const now = new Date()
  const confirmed = status === 'confirmed'
  const b = {
    id: uid(), facilityId: f.id, reference: 'BK-' + Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''),
    userId, courtIds: ids, date, start: segs[0].start, end: segs[segs.length - 1].end, segments: segs, customerName: name.trim(), customerPhone: phone, customerEmail: email || null,
    totalAmount: f.pricePerSlot * slots * ids.length, status, paymentStatus: confirmed ? 'offline' : 'unpaid', paymentMethod: confirmed ? 'offline' : null,
    paidAt: null, needsRefund: false,
    expiresAt: status === 'pending_payment' ? new Date(now.getTime() + f.holdMinutes * 60000).toISOString() : null,
    confirmedAt: confirmed ? now.toISOString() : null, cancelledAt: null, cancellationReason: null,
    createdByAdmin: byAdmin, adminNote: note || null, createdAt: now.toISOString(),
  }
  db.bookings.unshift(b)
  return b
}

const tenantFacility = () => db.facilities.find((f) => f.slug === TENANT.slug)

function slugStatus(s) {
  const slug = String(s || '').toLowerCase().trim()
  if (!SLUG_RE.test(slug) || slug.includes('--')) return { slug, available: false, reason: 'invalid' }
  if (RESERVED.has(slug)) return { slug, available: false, reason: 'reserved' }
  if (db.facilities.some((f) => f.slug === slug)) return { slug, available: false, reason: 'taken' }
  return { slug, available: true, reason: null }
}

function validateFacilityInput(p, { partial = false } = {}) {
  if (!partial || p.name !== undefined) if (String(p.name || '').trim().length < 2 || String(p.name).trim().length > 80) fail('invalid_facility_name')
  if (!partial || p.contactPhone) if (!/^\d{10,15}$/.test(cleanPhone(p.contactPhone))) fail('invalid_phone')
  if (!partial || p.openingTime !== undefined || p.closingTime !== undefined) {
    if (!p.openingTime || !p.closingTime || toMin(p.openingTime) >= toMin(p.closingTime)) fail('invalid_hours')
  }
  if (!partial || p.availableDurations !== undefined) {
    const d = p.availableDurations || []
    if (!d.length || d.some((h) => ![1, 2, 3, 4].includes(h))) fail('invalid_durations')
  }
  if (!partial || p.pricePerHour !== undefined) if (!(Number(p.pricePerHour) >= 0)) fail('invalid_price')
}

const rawApi = {
  mode: 'demo',

  auth: {
    async getUser() {
      return currentUser()
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signIn(email) {
      await wait()
      const found = Object.values(db.users).find((u) => u.email === email.trim().toLowerCase())
      if (!found) fail('invalid_credentials')
      db.sessionUserId = found.id
      save()
      emit()
      return found
    },
    async signUp({ email, name, phone }) {
      await wait()
      const e = email.trim().toLowerCase()
      if (Object.values(db.users).some((u) => u.email === e)) fail('User already registered')
      const u = { id: uid(), email: e, name: name || '', phone: cleanPhone(phone) }
      db.users[u.id] = u
      db.sessionUserId = u.id // demo skips email verification
      save()
      emit()
      return { needsVerification: false }
    },
    async signOut() {
      db.sessionUserId = null
      save()
      emit()
    },
    async sendReset() {
      await wait()
    },
    async updatePassword() {
      await wait()
    },
    async quickLogin(role) {
      db.sessionUserId = { owner: 'demo-owner', admin: 'demo-admin', customer: 'demo-customer' }[role] || 'demo-customer'
      save()
      emit()
      return currentUser()
    },
  },

  /* ---------------- tenant (player) side ---------------- */
  async getFacility() {
    await wait(120)
    const f = tenantFacility()
    if (!f) return { state: 'not_found' }
    const privileged = isMember(f.id) || currentUser()?.isPlatformAdmin
    if (f.status !== 'active' && !privileged) return { state: f.status === 'suspended' ? 'suspended' : 'not_live' }
    return {
      state: f.status === 'active' ? 'live' : 'preview',
      settings: publicFacility(f),
      courts: clone(db.courts.filter((c) => c.facilityId === f.id).sort((a, b) => a.number - b.number)),
    }
  },

  async publicFacilities() {
    await wait(100)
    return db.facilities.filter((f) => f.status === 'active').map((f) => ({ slug: f.slug, name: f.name, city: f.city, logoUrl: f.logoUrl, tagline: f.tagline }))
  },

  async getBusy(date) {
    await wait(150)
    expireStale()
    const f = tenantFacility()
    if (!f || (f.status !== 'active' && !isMember(f.id))) return []
    const me = currentUser()?.id
    const busy = db.bookings
      .filter((b) => b.facilityId === f.id && b.date === date && ACTIVE_STATUSES.includes(b.status))
      .flatMap((b) => b.courtIds.flatMap((courtId) => bookingSegments(b).map((g) => ({ courtId, start: g.start, end: g.end, kind: b.status === 'confirmed' ? 'confirmed' : 'pending', mine: b.userId === me }))))
    const blocked = db.blocks.filter((k) => k.facilityId === f.id && k.date === date).map((k) => ({ courtId: k.courtId, start: k.start, end: k.end, kind: 'blocked', mine: false }))
    return [...busy, ...blocked]
  },

  async createBooking({ courtIds, date, segments, name, phone }) {
    await wait(350)
    const u = requireUser()
    const f = tenantFacility() || fail('facility_not_found') // the tenant is resolved here, never supplied by the caller
    checkContact(name, phone)
    expireStale()
    const holds = db.bookings.filter((b) => b.userId === u.id && b.facilityId === f.id && b.status === 'pending_payment').length
    if (holds >= f.maxUnpaidHolds) fail('too_many_unpaid_holds')
    const b = createCore({ facility: f, userId: u.id, courtIds, date, segments, name, phone: cleanPhone(phone), email: u.email, status: 'pending_payment', byAdmin: false })
    db.users[u.id].name = name.trim()
    db.users[u.id].phone = cleanPhone(phone)
    save()
    return withCourt(b)
  },

  async listMyBookings() {
    await wait(200)
    const u = requireUser()
    const f = tenantFacility()
    expireStale()
    return db.bookings.filter((b) => b.userId === u.id && (!f || b.facilityId === f.id)).map(withCourt)
  },

  async getMyBooking(id) {
    await wait(150)
    const u = requireUser()
    expireStale()
    const b = db.bookings.find((x) => x.id === id && (x.userId === u.id || isMember(x.facilityId)))
    if (!b) fail('booking_not_found')
    return withCourt(b)
  },

  async cancelMyBooking(id) {
    await wait(300)
    const u = requireUser()
    const b = db.bookings.find((x) => x.id === id)
    if (!b || b.userId !== u.id) fail('booking_not_found')
    if (b.status !== 'pending_payment') fail('contact_owner_to_cancel')
    transition(b, 'cancelled')
    b.cancelledAt = new Date().toISOString()
    b.cancellationReason = 'Cancelled by customer'
    save()
    return withCourt(b)
  },

  // Demo mode only ever uses the pretend payment: no money, no gateway.
  payment: {
    mode: 'demo',
    async demoPay(id) {
      await wait(900)
      const u = requireUser()
      expireStale()
      const b = db.bookings.find((x) => x.id === id)
      if (!b || b.userId !== u.id) fail('booking_not_found')
      const f = facilityById(b.facilityId)
      if (!f.allowDemoPayments || f.paymentMode === 'razorpay') fail('demo_payments_disabled')
      if (b.status !== 'pending_payment') fail('booking_not_payable')
      transition(b, 'confirmed')
      Object.assign(b, { paymentStatus: 'demo', paymentMethod: 'demo', paidAt: new Date().toISOString(), confirmedAt: new Date().toISOString(), expiresAt: null })
      save()
      return withCourt(b)
    },
  },

  /* ---------------- facility owner side ---------------- */
  owner: {
    async myFacilities() {
      await wait(150)
      requireUser()
      return db.members.filter((m) => m.userId === db.sessionUserId).map((m) => ({ ...clone(facilityById(m.facilityId)), memberRole: m.role }))
    },
    async facility(fid) {
      await wait(120)
      requireMember(fid)
      return { settings: clone(facilityById(fid)), courts: clone(db.courts.filter((c) => c.facilityId === fid).sort((a, b) => a.number - b.number)) }
    },
    async checkSlugs(slugs) {
      await wait(180)
      requireUser()
      return [...new Set(slugs)].slice(0, 12).map(slugStatus)
    },
    async createFacility(p) {
      await wait(500)
      const u = requireUser()
      const limit = db.platformSettings.max_facilities_per_owner
      if (db.members.filter((m) => m.userId === u.id && m.role === 'owner').length >= limit) fail('facility_limit_reached')
      validateFacilityInput(p)
      const s = slugStatus(p.slug)
      if (!s.available) fail(s.reason === 'taken' ? 'slug_taken' : s.reason === 'reserved' ? 'slug_reserved' : 'invalid_slug')
      if (String(p.address || '').trim().length < 3 || String(p.city || '').trim().length < 2) fail('invalid_address')
      const courts = p.courts || []
      if (!courts.length) fail('invalid_courts')
      if (courts.length > db.platformSettings.max_courts_per_facility) fail('court_limit_reached')
      const f = newFacility({
        slug: s.slug, name: p.name.trim(), tagline: p.tagline?.trim() || 'Your Court. Your Game.', logoUrl: p.logoUrl || '', address: p.address.trim(), city: p.city.trim(),
        contactPhone: cleanPhone(p.contactPhone), contactEmail: p.contactEmail || '', openingTime: p.openingTime, closingTime: p.closingTime,
        pricePerSlot: Math.round((Number(p.pricePerHour) / 2) * 100) / 100, availableDurations: p.availableDurations, maxSlotsPerBooking: Math.max(...p.availableDurations) * 2,
        closedWeekdays: p.closedWeekdays || [], holidays: p.holidays || [], cancellationPolicy: p.cancellationPolicy?.trim() || 'Contact the facility to cancel a confirmed booking.',
        status: db.platformSettings.require_facility_approval ? 'pending' : 'active', maxCourts: db.platformSettings.max_courts_per_facility, allowDemoPayments: true, createdBy: u.id,
      })
      db.facilities.push(f)
      db.members.push({ facilityId: f.id, userId: u.id, role: 'owner' })
      courts.forEach((c, i) => db.courts.push({ id: `${f.id}-c${i + 1}`, facilityId: f.id, number: i + 1, name: c.name?.trim() || `Court ${i + 1}`, imageUrl: c.imageUrl || '', isActive: true }))
      audit(f.id, 'facility_created', 'facility', { slug: f.slug, status: f.status })
      save()
      return clone(f)
    },
    async updateFacility(fid, p) {
      await wait(300)
      requireMember(fid)
      const f = facilityById(fid)
      validateFacilityInput({ ...f, pricePerHour: f.pricePerSlot * 2, ...p }, { partial: true })
      // slug, status, plan and maxCourts are intentionally NOT editable by owners
      const allowed = ['name', 'tagline', 'logoUrl', 'address', 'city', 'contactPhone', 'contactEmail', 'openingTime', 'closingTime', 'availableDurations', 'maxUnpaidHolds', 'holdMinutes', 'advanceBookingDays', 'cancellationPolicy', 'closedWeekdays', 'holidays', 'allowDemoPayments']
      for (const k of allowed) if (p[k] !== undefined) f[k] = p[k]
      if (p.pricePerHour !== undefined) f.pricePerSlot = Math.round((Number(p.pricePerHour) / 2) * 100) / 100
      if (p.availableDurations) f.maxSlotsPerBooking = Math.max(...p.availableDurations) * 2
      audit(fid, 'facility_updated', 'facility', { fields: Object.keys(p) })
      save()
      return clone(f)
    },
    async addCourt(fid, { name, imageUrl }) {
      await wait(200)
      requireMember(fid)
      const f = facilityById(fid)
      const mine = db.courts.filter((c) => c.facilityId === fid)
      if (mine.length >= f.maxCourts) fail('court_limit_reached')
      const number = Math.max(0, ...mine.map((c) => c.number)) + 1
      const c = { id: uid(), facilityId: fid, number, name: name?.trim() || `Court ${number}`, imageUrl: imageUrl || '', isActive: true }
      db.courts.push(c)
      save()
      return clone(c)
    },
    async updateCourt(id, patch) {
      await wait(200)
      const c = db.courts.find((x) => x.id === id) || fail('court_unavailable')
      requireMember(c.facilityId)
      for (const k of ['name', 'imageUrl', 'isActive']) if (patch[k] !== undefined) c[k] = patch[k]
      save()
      return clone(c)
    },
    async removeCourt(id) {
      await wait(200)
      const c = db.courts.find((x) => x.id === id) || fail('court_unavailable')
      requireMember(c.facilityId)
      if (db.bookings.some((b) => b.courtIds.includes(id)) || db.blocks.some((k) => k.courtId === id)) fail('court_in_use')
      db.courts = db.courts.filter((x) => x.id !== id)
      save()
    },
    async savePaymentConfig(fid, { keyId, keySecret }) {
      await wait(500)
      requireMember(fid)
      if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(String(keyId || ''))) fail('invalid_razorpay_key_id')
      if (String(keySecret || '').length < 10) fail('invalid_razorpay_key_secret')
      // NOTE: demo mode never contacts Razorpay and never stores the secret.
      const f = facilityById(fid)
      f.paymentMode = 'razorpay'
      f.razorpayKeyId = keyId
      audit(fid, 'payments_connected', 'facility', { mode: keyId.startsWith('rzp_live_') ? 'live' : 'test', demo: true })
      save()
      return { ok: true }
    },
    async removePaymentConfig(fid) {
      await wait(300)
      requireMember(fid)
      const f = facilityById(fid)
      f.paymentMode = 'none'
      f.razorpayKeyId = null
      audit(fid, 'payments_disconnected', 'facility', {})
      save()
    },
  },

  admin: {
    async listBookings(fid) {
      await wait(200)
      requireMember(fid)
      expireStale()
      return db.bookings.filter((b) => b.facilityId === fid).map(withCourt)
    },
    async setStatus(id, status, reason) {
      await wait(300)
      const b = db.bookings.find((x) => x.id === id) || fail('booking_not_found')
      requireMember(b.facilityId)
      if (String(reason || '').trim().length < 3) fail('reason_required')
      transition(b, status)
      if (status === 'confirmed') {
        Object.assign(b, { confirmedAt: new Date().toISOString(), expiresAt: null, adminNote: reason, paymentStatus: 'offline', paymentMethod: 'offline' })
      } else {
        b.cancelledAt = new Date().toISOString()
        b.cancellationReason = reason
        if (b.paymentStatus === 'paid') b.needsRefund = true
      }
      audit(b.facilityId, `order_${status}`, 'order', { reference: b.reference, reason })
      save()
      return withCourt(b)
    },
    async markRefunded(id, note) {
      await wait(250)
      const b = db.bookings.find((x) => x.id === id) || fail('booking_not_found')
      requireMember(b.facilityId)
      Object.assign(b, { paymentStatus: 'refunded', needsRefund: false, adminNote: note || b.adminNote })
      audit(b.facilityId, 'refund_recorded', 'order', { reference: b.reference, note })
      save()
      return withCourt(b)
    },
    async createBooking({ facilityId, courtIds, date, segments, name, phone, email, confirm, note }) {
      await wait(300)
      requireMember(facilityId)
      checkContact(name, phone)
      const b = createCore({ facility: facilityById(facilityId), userId: null, courtIds, date, segments, name, phone: cleanPhone(phone), email: email || null, status: confirm ? 'confirmed' : 'pending_payment', byAdmin: true, note })
      audit(facilityId, 'order_created_manually', 'order', { reference: b.reference, confirmed: !!confirm })
      save()
      return withCourt(b)
    },
    async listBlocks(fid) {
      await wait(150)
      requireMember(fid)
      return clone(db.blocks.filter((k) => k.facilityId === fid))
    },
    async createBlock({ courtId, date, start, end, reason }) {
      await wait(250)
      const c = db.courts.find((x) => x.id === courtId) || fail('court_unavailable')
      requireMember(c.facilityId)
      if (toMin(start) >= toMin(end)) fail('invalid_time_range')
      expireStale()
      if (db.bookings.some((b) => b.courtIds.includes(courtId) && b.date === date && ACTIVE_STATUSES.includes(b.status) && bookingSegments(b).some((g) => overlaps(g.start, g.end, start, end)))) fail('block_conflicts_with_booking')
      if (db.blocks.some((k) => k.courtId === courtId && k.date === date && overlaps(k.start, k.end, start, end))) fail('block_overlaps_block')
      const k = { id: uid(), facilityId: c.facilityId, courtId, date, start, end, reason: reason || null, createdAt: new Date().toISOString() }
      db.blocks.push(k)
      audit(c.facilityId, 'court_blocked', 'blocked_slot', { courtId, date, start, end, reason })
      save()
      return k
    },
    async removeBlock(id) {
      await wait(200)
      const k = db.blocks.find((x) => x.id === id)
      if (!k) return
      requireMember(k.facilityId)
      db.blocks = db.blocks.filter((x) => x.id !== id)
      audit(k.facilityId, 'court_unblocked', 'blocked_slot', { id })
      save()
    },
    async listAudit(fid) {
      await wait(150)
      requireMember(fid)
      return clone(db.audit.filter((a) => a.facilityId === fid))
    },
  },

  /* ---------------- platform administrator ---------------- */
  platform: {
    async isAdmin() {
      return !!currentUser()?.isPlatformAdmin
    },
    async listFacilities() {
      await wait(200)
      requirePlatformAdmin()
      return db.facilities.map((f) => {
        const owner = db.members.find((m) => m.facilityId === f.id && m.role === 'owner')
        const u = owner && db.users[owner.userId]
        const orders = db.bookings.filter((b) => b.facilityId === f.id)
        return {
          id: f.id, slug: f.slug, name: f.name, city: f.city, status: f.status, suspendedReason: f.suspendedReason, maxCourts: f.maxCourts, createdAt: f.createdAt,
          ownerEmail: u?.email || '', ownerName: u?.name || '', courts: db.courts.filter((c) => c.facilityId === f.id).length, orders: orders.length,
          verifiedRevenue: orders.filter((o) => o.paymentStatus === 'paid' && !o.needsRefund).reduce((s, o) => s + o.totalAmount, 0),
        }
      })
    },
    async listOwners() {
      await wait(150)
      requirePlatformAdmin()
      const ids = [...new Set(db.members.map((m) => m.userId))]
      return ids.map((id) => ({ userId: id, email: db.users[id]?.email, fullName: db.users[id]?.name, phone: db.users[id]?.phone, facilities: db.members.filter((m) => m.userId === id && m.role === 'owner').length }))
    },
    async metrics() {
      await wait(150)
      requirePlatformAdmin()
      const by = (s) => db.facilities.filter((f) => f.status === s).length
      return {
        facilities: db.facilities.length, facilitiesActive: by('active'), facilitiesPending: by('pending'), facilitiesSuspended: by('suspended'),
        owners: new Set(db.members.filter((m) => m.role === 'owner').map((m) => m.userId)).size,
        players: new Set(db.bookings.map((b) => b.userId).filter(Boolean)).size,
        ordersTotal: db.bookings.length, ordersConfirmed: db.bookings.filter((b) => b.status === 'confirmed').length,
        ordersLast30d: db.bookings.length, verifiedRevenue: db.bookings.filter((b) => b.paymentStatus === 'paid' && !b.needsRefund).reduce((s, b) => s + b.totalAmount, 0),
      }
    },
    async setStatus(fid, status, reason) {
      await wait(300)
      requirePlatformAdmin()
      if (!['draft', 'pending', 'active', 'suspended'].includes(status)) fail('invalid_status')
      if (status === 'suspended' && String(reason || '').trim().length < 3) fail('reason_required')
      const f = facilityById(fid) || fail('facility_not_found')
      f.status = status
      f.suspendedReason = status === 'suspended' ? reason.trim() : null
      audit(fid, `platform_status_${status}`, 'facility', { reason })
      save()
    },
    async setSlug(fid, slug) {
      await wait(300)
      requirePlatformAdmin()
      const s = slugStatus(slug)
      if (!s.available) fail(s.reason === 'taken' ? 'slug_taken' : s.reason === 'reserved' ? 'slug_reserved' : 'invalid_slug')
      const f = facilityById(fid) || fail('facility_not_found')
      f.slug = s.slug
      audit(fid, 'platform_slug_changed', 'facility', { slug: s.slug })
      save()
    },
    async setLimits(fid, maxCourts) {
      await wait(200)
      requirePlatformAdmin()
      if (!(maxCourts >= 1 && maxCourts <= 50)) fail('invalid_courts')
      const f = facilityById(fid) || fail('facility_not_found')
      f.maxCourts = maxCourts
      audit(fid, 'platform_limits_changed', 'facility', { maxCourts })
      save()
    },
    async getSettings() {
      await wait(100)
      requirePlatformAdmin()
      return { ...db.platformSettings }
    },
    async setSetting(key, value) {
      await wait(200)
      requirePlatformAdmin()
      if (!(key in db.platformSettings)) fail('invalid_status')
      db.platformSettings[key] = value
      audit(null, 'platform_setting_changed', 'platform_settings', { key, value })
      save()
    },
  },

  resetDemo() {
    db = seed()
    save()
    emit()
  },
}

/** Re-read the shared demo store before every call (other tabs may have changed it). */
function withFreshState(o) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'function' && k !== 'onChange') o[k] = (...a) => { if (k !== 'resetDemo') db = load() || db; return v(...a) }
    else if (v && typeof v === 'object') withFreshState(v)
  }
  return o
}

export const demoApi = withFreshState(rawApi)
