// REAL backend: Supabase Auth + Postgres. All booking writes go through SECURITY DEFINER RPCs
// (see supabase/migrations), so conflicts, holds, status transitions, payment settlement and
// owner-only actions are enforced by the database / Edge Functions, not by this client code.
import { createClient } from '@supabase/supabase-js'
import { razorpayEnabled, supabaseConfigured, supabaseUrl, supabaseAnonKey } from '../config.js'
import { norm } from '../time.js'

// Only constructed when env vars are present, so demo mode never touches the network.
export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

const check = ({ data, error }) => {
  if (error) throw error
  return data
}

const mapSettings = (r) => ({
  name: r.name, tagline: r.tagline, address: r.address,
  contactPhone: r.contact_phone || '', contactEmail: r.contact_email || '',
  openingTime: norm(r.opening_time), closingTime: norm(r.closing_time),
  slotMinutes: r.slot_minutes, // fixed at 30 for now; one booking = one slot
  pricePerSlot: Number(r.price_per_slot),
  maxSlotsPerBooking: r.max_slots_per_booking, maxUnpaidHolds: r.max_unpaid_holds, holdMinutes: r.hold_minutes,
  advanceBookingDays: r.advance_booking_days, timezone: r.timezone,
  allowDemoPayments: r.allow_demo_payments,
  cancellationPolicy: r.cancellation_policy,
})

const SETTINGS_COLUMNS = {
  name: 'name', tagline: 'tagline', address: 'address', contactPhone: 'contact_phone', contactEmail: 'contact_email',
  openingTime: 'opening_time', closingTime: 'closing_time', pricePerSlot: 'price_per_slot',
  maxSlotsPerBooking: 'max_slots_per_booking', maxUnpaidHolds: 'max_unpaid_holds', holdMinutes: 'hold_minutes', advanceBookingDays: 'advance_booking_days',
  allowDemoPayments: 'allow_demo_payments', cancellationPolicy: 'cancellation_policy',
}

const mapOrder = (r) => {
  const rows = r.bookings || []
  const byId = new Map(rows.map((x) => [x.court_id, x.courts?.number]))
  return {
    id: r.id, reference: r.reference, userId: r.user_id,
    courtIds: [...byId.keys()], courtNumbers: [...byId.values()].filter(Boolean).sort((a, b) => a - b),
    date: r.booking_date, start: norm(r.start_time), end: norm(r.end_time),
    segments: (r.segments?.length ? r.segments : [{ start: r.start_time, end: r.end_time }]).map((g) => ({ start: norm(g.start), end: norm(g.end) })),
    customerName: r.customer_name, customerPhone: r.customer_phone, customerEmail: r.customer_email,
    totalAmount: Number(r.total_amount), status: r.status, paymentStatus: r.payment_status, paymentMethod: r.payment_method,
    paidAt: r.paid_at, needsRefund: r.needs_refund, expiresAt: r.expires_at, confirmedAt: r.confirmed_at,
    cancelledAt: r.cancelled_at, cancellationReason: r.cancellation_reason, createdByAdmin: r.created_by_admin,
    adminNote: r.admin_note, createdAt: r.created_at,
  }
}

const ORDER_SELECT = '*, bookings(court_id, courts(number))'

async function fetchOrder(id) {
  return mapOrder(check(await supabase.from('orders').select(ORDER_SELECT).eq('id', id).single()))
}

async function mapUser(authUser) {
  if (!authUser) return null
  const { data } = await supabase.from('profiles').select('full_name, phone, role').eq('id', authUser.id).maybeSingle()
  return {
    id: authUser.id, email: authUser.email,
    name: data?.full_name || authUser.user_metadata?.full_name || '',
    phone: data?.phone || authUser.user_metadata?.phone || '',
    role: data?.role || 'customer', // display hint only — every owner action is re-checked by the DB
  }
}

/** Edge Function call; surfaces the function's JSON `error` code as the Error message. */
async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let code = error.message
    try { code = (await error.context.json()).error || code } catch { /* keep message */ }
    throw new Error(code)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const supabaseApi = {
  mode: 'supabase',

  auth: {
    async getUser() {
      const { data } = await supabase.auth.getSession()
      return mapUser(data.session?.user)
    },
    onChange(cb) {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        // Defer: calling supabase inside this callback can deadlock.
        setTimeout(async () => cb(await mapUser(session?.user), event), 0)
      })
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      check(await supabase.auth.signInWithPassword({ email: email.trim(), password }))
    },
    async signUp({ email, password, name, phone }) {
      const data = check(
        await supabase.auth.signUp({
          email: email.trim(),
          password,
          // name/phone are collected AFTER login (at checkout), so signup only needs email + password
          options: { data: name || phone ? { full_name: name, phone } : {}, emailRedirectTo: `${window.location.origin}/continue` },
        }),
      )
      return { needsVerification: !data.session }
    },
    async signOut() {
      await supabase.auth.signOut()
    },
    async sendReset(email) {
      check(await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/reset` }))
    },
    async updatePassword(password) {
      check(await supabase.auth.updateUser({ password }))
    },
  },

  async getFacility() {
    const [s, c] = await Promise.all([
      supabase.from('facility_settings').select('*').eq('id', 1).single(),
      supabase.from('courts').select('*').order('number'),
    ])
    return {
      settings: mapSettings(check(s)),
      courts: check(c).map((r) => ({ id: r.id, number: r.number, name: r.name, isActive: r.is_active })),
    }
  },

  async getBusy(date) {
    const rows = check(await supabase.rpc('get_busy_slots', { p_date: date }))
    return rows.map((r) => ({ courtId: r.court_id, start: norm(r.start_time), end: norm(r.end_time), kind: r.kind, mine: r.mine }))
  },

  // One date + one or more separate time ranges + 1..N courts, reserved atomically by the database.
  async createBooking({ courtIds, date, segments, name, phone }) {
    const row = check(await supabase.rpc('create_order', { p_court_ids: courtIds, p_date: date, p_segments: segments, p_name: name, p_phone: phone }))
    return fetchOrder(row.id)
  },

  async listMyBookings() {
    await supabase.rpc('expire_stale_bookings')
    const { data: auth } = await supabase.auth.getUser()
    const rows = check(
      await supabase.from('orders').select(ORDER_SELECT).eq('user_id', auth.user.id)
        .order('booking_date', { ascending: false }).order('start_time', { ascending: false }),
    )
    return rows.map(mapOrder)
  },

  async getMyBooking(id) {
    await supabase.rpc('expire_stale_bookings')
    return fetchOrder(id)
  },

  async cancelMyBooking(id) {
    check(await supabase.rpc('cancel_my_order', { p_order_id: id }))
    return fetchOrder(id)
  },

  payment: {
    // 'razorpay' when VITE_RAZORPAY_KEY_ID is set; otherwise the owner-gated test payment.
    mode: razorpayEnabled ? 'razorpay' : 'demo',
    createRazorpayOrder: (orderId) => callFunction('create-razorpay-order', { orderId }),
    verifyRazorpay: (orderId, resp) => callFunction('verify-razorpay-payment', { orderId, ...resp }),
    async demoPay(id) {
      check(await supabase.rpc('demo_pay_order', { p_order_id: id }))
      return fetchOrder(id)
    },
  },

  admin: {
    async listBookings() {
      await supabase.rpc('expire_stale_bookings') // release lapsed unpaid holds (idempotent)
      const rows = check(
        await supabase.from('orders').select(ORDER_SELECT).order('booking_date', { ascending: false }).order('start_time', { ascending: true }).limit(1000),
      )
      return rows.map(mapOrder)
    },
    async setStatus(id, status, reason) {
      check(await supabase.rpc('admin_set_order_status', { p_order_id: id, p_status: status, p_reason: reason }))
      return fetchOrder(id)
    },
    async markRefunded(id, note) {
      check(await supabase.rpc('admin_mark_refunded', { p_order_id: id, p_note: note || null }))
      return fetchOrder(id)
    },
    async createBooking({ courtIds, date, segments, name, phone, email, confirm, note }) {
      const row = check(
        await supabase.rpc('admin_create_order', {
          p_court_ids: courtIds, p_date: date, p_segments: segments, p_name: name, p_phone: phone,
          p_email: email || null, p_confirm: !!confirm, p_note: note || null,
        }),
      )
      return fetchOrder(row.id)
    },
    async listBlocks() {
      const rows = check(await supabase.from('blocked_slots').select('*').order('block_date', { ascending: false }).limit(500))
      return rows.map((r) => ({ id: r.id, courtId: r.court_id, date: r.block_date, start: norm(r.start_time), end: norm(r.end_time), reason: r.reason, createdAt: r.created_at }))
    },
    async createBlock({ courtId, date, start, end, reason }) {
      check(await supabase.rpc('admin_create_block', { p_court_id: courtId, p_date: date, p_start: start, p_end: end, p_reason: reason || null }))
    },
    async removeBlock(id) {
      check(await supabase.rpc('admin_remove_block', { p_block_id: id }))
    },
    async updateSettings(patch) {
      const row = {}
      for (const [k, v] of Object.entries(patch)) {
        if (SETTINGS_COLUMNS[k]) row[SETTINGS_COLUMNS[k]] = v === '' ? null : v
      }
      // text columns that are NOT NULL in the schema must not become null
      for (const k of ['name', 'tagline', 'address', 'cancellation_policy']) if (k in row && row[k] === null) row[k] = ''
      const data = check(await supabase.from('facility_settings').update(row).eq('id', 1).select().single())
      return mapSettings(data)
    },
    async listAudit() {
      const rows = check(await supabase.from('audit_events').select('*').order('created_at', { ascending: false }).limit(200))
      return rows.map((r) => ({ id: r.id, actorEmail: r.actor_email, action: r.action, entityType: r.entity_type, details: r.details, createdAt: r.created_at }))
    },
  },
}
