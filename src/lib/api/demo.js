// DEMO backend: local, in-memory mock (mirrored to sessionStorage so a refresh keeps your session).
// - No network, no real accounts, no real payments, no emails/SMS.
// - Demo "login" accepts any password. It is NOT secure and never touches Supabase.
// - Rules mirror supabase/migrations/0001_schema.sql so behaviour matches the real backend.
import { addDays, bookingSegments, toMin, todayISO, nowMinutes } from '../time.js'
import { TRANSITIONS, ACTIVE_STATUSES } from '../status.js'

const KEY = 'badminton-demo-v3'
const wait = (ms = 220) => new Promise((r) => setTimeout(r, ms))
const uid = () => crypto.randomUUID()
const fail = (code) => {
  throw new Error(code)
}

const DEFAULT_SETTINGS = {
  name: 'Smash Court',
  tagline: 'Your Court. Your Game.',
  address: 'Your address here (set in Owner → Settings)',
  contactPhone: '',
  contactEmail: '',
  openingTime: '06:00',
  closingTime: '22:00',
  slotMinutes: 30,
  maxSlotsPerBooking: 8,
  pricePerSlot: 150,
  maxUnpaidHolds: 2,
  holdMinutes: 15,
  advanceBookingDays: 14,
  allowDemoPayments: true,
  timezone: 'Asia/Kolkata',
  cancellationPolicy: 'Contact the facility to cancel a confirmed booking. Refund terms are set by the owner.',
}

function seed() {
  const today = todayISO(DEFAULT_SETTINGS.timezone)
  const courts = [1, 2, 3].map((n) => ({ id: `court-${n}`, number: n, name: `Court ${n}`, isActive: true }))
  const users = {
    'demo-customer': { id: 'demo-customer', email: 'customer@demo.local', name: 'Demo Customer', phone: '9000000001', role: 'customer' },
    'demo-owner': { id: 'demo-owner', email: 'owner@demo.local', name: 'Demo Owner', phone: '', role: 'owner' },
  }
  const now = new Date().toISOString()
  const mk = (over) => {
    const courtIds = over.courtIds || ['court-1']
    return {
      id: uid(), reference: 'BK-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      userId: 'demo-other', courtIds, date: today, start: '18:00', end: '18:30',
      customerName: 'Sample Player', customerPhone: '9000000002', customerEmail: 'sample@demo.local',
      totalAmount: 150 * courtIds.length, status: 'confirmed', paymentStatus: 'demo', paymentMethod: 'demo',
      paidAt: now, needsRefund: false, expiresAt: null, confirmedAt: now, cancelledAt: null,
      cancellationReason: null, createdByAdmin: false, adminNote: null, createdAt: now, ...over,
    }
  }
  const withSegs = (o) => ({ ...o, segments: o.segments || [{ start: o.start, end: o.end }] })
  const mineCustomer = { userId: 'demo-customer', customerName: 'Demo Customer', customerPhone: '9000000001', customerEmail: 'customer@demo.local' }
  const bookings = [
    mk({ courtIds: ['court-1', 'court-2'], start: '18:00', end: '18:30', customerName: 'Aarav (sample)' }),
    mk({ courtIds: ['court-3'], date: addDays(today, 1), start: '07:00', end: '07:30', customerName: 'Kabir (sample)', status: 'pending_payment', paymentStatus: 'unpaid', paymentMethod: null, paidAt: null, confirmedAt: null, expiresAt: new Date(Date.now() + 10 * 60000).toISOString() }),
    mk({ ...mineCustomer, courtIds: ['court-1'], date: addDays(today, -2), start: '17:00', end: '17:30' }),
    mk({ ...mineCustomer, courtIds: ['court-2', 'court-3'], date: addDays(today, 3), start: '20:00', end: '20:30' }),
    mk({ ...mineCustomer, courtIds: ['court-3'], date: addDays(today, 5), start: '10:00', end: '10:30', status: 'cancelled', paymentStatus: 'unpaid', paymentMethod: null, paidAt: null, confirmedAt: null, cancelledAt: now, cancellationReason: 'Cancelled by customer' }),
  ].map(withSegs)
  const blocks = [{ id: uid(), courtId: 'court-3', date: today, start: '12:00', end: '14:00', reason: 'Net replacement (sample)', createdAt: new Date().toISOString() }]
  return { settings: DEFAULT_SETTINGS, courts, users, bookings, blocks, audit: [], sessionUserId: null }
}

let db = load() || seed()
function load() {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* storage unavailable — demo still works in memory */
  }
}
const listeners = new Set()
const emit = () => listeners.forEach((cb) => cb(currentUser()))
const currentUser = () => (db.sessionUserId ? db.users[db.sessionUserId] || null : null)
const requireUser = () => currentUser() || fail('not_authenticated')
const requireOwner = () => {
  const u = requireUser()
  if (u.role !== 'owner') fail('forbidden')
  return u
}
const clone = (x) => JSON.parse(JSON.stringify(x))
const withCourt = (b) => ({
  ...clone(b),
  courtNumbers: b.courtIds.map((id) => db.courts.find((c) => c.id === id)?.number).filter(Boolean).sort((x, y) => x - y),
})

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
function audit(action, entity, details) {
  const u = currentUser()
  db.audit.unshift({ id: uid(), actorEmail: u?.email, action, entityType: entity, details, createdAt: new Date().toISOString() })
}
const overlaps = (aS, aE, bS, bE) => toMin(aS) < toMin(bE) && toMin(aE) > toMin(bS)

function createCore({ userId, courtIds, date, segments, name, phone, email, status, byAdmin, note }) {
  const s = db.settings
  const ids = [...new Set(courtIds || [])]
  if (!ids.length) fail('no_courts_selected')
  if (ids.some((id) => !db.courts.find((c) => c.id === id && c.isActive))) fail('court_unavailable')
  const segs = [...(segments || [])].sort((a, b) => toMin(a.start) - toMin(b.start))
  if (!segs.length) fail('invalid_slot')
  let slots = 0
  segs.forEach((g, i) => {
    if (toMin(g.end) <= toMin(g.start)) fail('invalid_time_range')
    if (toMin(g.start) < toMin(s.openingTime) || toMin(g.end) > toMin(s.closingTime)) fail('outside_operating_hours')
    const mins = toMin(g.end) - toMin(g.start)
    if (mins % s.slotMinutes !== 0 || (toMin(g.start) - toMin(s.openingTime)) % s.slotMinutes !== 0) fail('invalid_slot')
    if (i && toMin(g.start) < toMin(segs[i - 1].end)) fail('invalid_slot')
    slots += mins / s.slotMinutes
  })
  if (slots > s.maxSlotsPerBooking) fail('too_many_slots')
  const today = todayISO(s.timezone)
  if (!byAdmin) {
    if (date < today || (date === today && toMin(segs[0].start) <= nowMinutes(s.timezone))) fail('slot_in_past')
    if (date > addDays(today, s.advanceBookingDays - 1)) fail('too_far_ahead')
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
    id: uid(), reference: 'BK-' + Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''),
    userId, courtIds: ids, date, start: segs[0].start, end: segs[segs.length - 1].end, segments: segs, customerName: name.trim(), customerPhone: phone, customerEmail: email || null,
    totalAmount: s.pricePerSlot * slots * ids.length, status, paymentStatus: confirmed ? 'offline' : 'unpaid', paymentMethod: confirmed ? 'offline' : null,
    paidAt: null, needsRefund: false,
    expiresAt: status === 'pending_payment' ? new Date(now.getTime() + s.holdMinutes * 60000).toISOString() : null,
    confirmedAt: confirmed ? now.toISOString() : null, cancelledAt: null, cancellationReason: null,
    createdByAdmin: byAdmin, adminNote: note || null, createdAt: now.toISOString(),
  }
  db.bookings.unshift(b)
  return b
}

const cleanPhone = (p) => String(p || '').replace(/\D/g, '')
function checkContact(name, phone) {
  if (String(name || '').trim().length < 2) fail('invalid_name')
  if (!/^\d{10,15}$/.test(cleanPhone(phone))) fail('invalid_phone')
}

export const demoApi = {
  mode: 'demo',

  auth: {
    async getUser() {
      return currentUser()
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signIn(email, _password) {
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
      const u = { id: uid(), email: e, name: name || '', phone: cleanPhone(phone), role: 'customer' }
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
      db.sessionUserId = role === 'owner' ? 'demo-owner' : 'demo-customer'
      save()
      emit()
      return currentUser()
    },
  },

  async getFacility() {
    await wait(120)
    return { settings: clone(db.settings), courts: clone(db.courts) }
  },

  async getBusy(date) {
    await wait(150)
    expireStale()
    const me = currentUser()?.id
    const busy = db.bookings
      .filter((b) => b.date === date && ACTIVE_STATUSES.includes(b.status))
      .flatMap((b) => b.courtIds.flatMap((courtId) => bookingSegments(b).map((g) => ({ courtId, start: g.start, end: g.end, kind: b.status === 'confirmed' ? 'confirmed' : 'pending', mine: b.userId === me }))))
    const blocked = db.blocks.filter((k) => k.date === date).map((k) => ({ courtId: k.courtId, start: k.start, end: k.end, kind: 'blocked', mine: false }))
    return [...busy, ...blocked]
  },

  async createBooking({ courtIds, date, segments, name, phone }) {
    await wait(350)
    const u = requireUser()
    checkContact(name, phone)
    expireStale()
    const holds = db.bookings.filter((b) => b.userId === u.id && b.status === 'pending_payment').length
    if (holds >= db.settings.maxUnpaidHolds) fail('too_many_unpaid_holds')
    const b = createCore({ userId: u.id, courtIds, date, segments, name, phone: cleanPhone(phone), email: u.email, status: 'pending_payment', byAdmin: false })
    u.name = name.trim()
    u.phone = cleanPhone(phone)
    save()
    return withCourt(b)
  },

  async listMyBookings() {
    await wait(200)
    const u = requireUser()
    expireStale()
    return db.bookings.filter((b) => b.userId === u.id).map(withCourt)
  },

  async getMyBooking(id) {
    await wait(150)
    const u = requireUser()
    expireStale()
    const b = db.bookings.find((x) => x.id === id && (x.userId === u.id || u.role === 'owner'))
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
      if (b.status !== 'pending_payment') fail('booking_not_payable')
      transition(b, 'confirmed')
      Object.assign(b, { paymentStatus: 'demo', paymentMethod: 'demo', paidAt: new Date().toISOString(), confirmedAt: new Date().toISOString(), expiresAt: null })
      save()
      return withCourt(b)
    },
  },

  admin: {
    async listBookings() {
      await wait(200)
      requireOwner()
      expireStale()
      return db.bookings.map(withCourt)
    },
    async setStatus(id, status, reason) {
      await wait(300)
      requireOwner()
      if (String(reason || '').trim().length < 3) fail('reason_required')
      const b = db.bookings.find((x) => x.id === id) || fail('booking_not_found')
      transition(b, status)
      if (status === 'confirmed') {
        Object.assign(b, { confirmedAt: new Date().toISOString(), expiresAt: null, adminNote: reason, paymentStatus: 'offline', paymentMethod: 'offline' })
      } else {
        b.cancelledAt = new Date().toISOString()
        b.cancellationReason = reason
        if (b.paymentStatus === 'paid') b.needsRefund = true
      }
      audit(`order_${status}`, 'order', { reference: b.reference, reason })
      save()
      return withCourt(b)
    },
    async markRefunded(id, note) {
      await wait(250)
      requireOwner()
      const b = db.bookings.find((x) => x.id === id) || fail('booking_not_found')
      Object.assign(b, { paymentStatus: 'refunded', needsRefund: false, adminNote: note || b.adminNote })
      audit('refund_recorded', 'order', { reference: b.reference, note })
      save()
      return withCourt(b)
    },
    async createBooking({ courtIds, date, segments, name, phone, email, confirm, note }) {
      await wait(300)
      requireOwner()
      checkContact(name, phone)
      const b = createCore({ userId: null, courtIds, date, segments, name, phone: cleanPhone(phone), email: email || null, status: confirm ? 'confirmed' : 'pending_payment', byAdmin: true, note })
      audit('order_created_manually', 'order', { reference: b.reference, confirmed: !!confirm })
      save()
      return withCourt(b)
    },
    async listBlocks() {
      await wait(150)
      requireOwner()
      return clone(db.blocks)
    },
    async createBlock({ courtId, date, start, end, reason }) {
      await wait(250)
      requireOwner()
      if (toMin(start) >= toMin(end)) fail('invalid_time_range')
      expireStale()
      if (db.bookings.some((b) => b.courtIds.includes(courtId) && b.date === date && ACTIVE_STATUSES.includes(b.status) && bookingSegments(b).some((g) => overlaps(g.start, g.end, start, end)))) fail('block_conflicts_with_booking')
      if (db.blocks.some((k) => k.courtId === courtId && k.date === date && overlaps(k.start, k.end, start, end))) fail('block_overlaps_block')
      const k = { id: uid(), courtId, date, start, end, reason: reason || null, createdAt: new Date().toISOString() }
      db.blocks.push(k)
      audit('court_blocked', 'blocked_slot', { courtId, date, start, end, reason })
      save()
      return k
    },
    async removeBlock(id) {
      await wait(200)
      requireOwner()
      db.blocks = db.blocks.filter((k) => k.id !== id)
      audit('court_unblocked', 'blocked_slot', { id })
      save()
    },
    async updateSettings(patch) {
      await wait(300)
      requireOwner()
      db.settings = { ...db.settings, ...patch }
      audit('settings_updated', 'facility_settings', { pricePerSlot: db.settings.pricePerSlot })
      save()
      return clone(db.settings)
    },
    async listAudit() {
      await wait(150)
      requireOwner()
      return clone(db.audit)
    },
  },

  resetDemo() {
    db = seed()
    save()
    emit()
  },
}

