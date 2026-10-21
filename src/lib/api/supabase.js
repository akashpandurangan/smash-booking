// REAL backend: Supabase Auth + Postgres + Edge Functions (multi-tenant).
// Every booking write goes through SECURITY DEFINER RPCs that re-derive the facility server-side
// (customers pass the tenant SLUG, never a facility id; owners are authorised via facility_members),
// so isolation, conflicts, status transitions and payment settlement are enforced by the database.
import { createClient } from '@supabase/supabase-js'
import { supabaseConfigured, supabaseUrl, supabaseAnonKey } from '../config.js'
import { TENANT } from '../tenant.js'
import { norm } from '../time.js'
import { prepareImage } from '../images.js'

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

/* ---------------- mappers (DB snake_case → app camelCase) ---------------- */
const mapFacility = (r) => ({
  id: r.id, slug: r.slug, name: r.name, tagline: r.tagline, logoUrl: r.logo_url || '',
  address: r.address || '', city: r.city || '', contactPhone: r.contact_phone || '', contactEmail: r.contact_email || '',
  status: r.status, suspendedReason: r.suspended_reason || null, plan: r.plan, maxCourts: r.max_courts,
  openingTime: norm(r.opening_time), closingTime: norm(r.closing_time), slotMinutes: r.slot_minutes,
  pricePerSlot: Number(r.price_per_slot), maxSlotsPerBooking: r.max_slots_per_booking, maxUnpaidHolds: r.max_unpaid_holds,
  holdMinutes: r.hold_minutes, advanceBookingDays: r.advance_booking_days, timezone: r.timezone,
  cancellationPolicy: r.cancellation_policy, availableDurations: r.available_durations || [1, 2, 3, 4],
  description: r.description || '', locality: r.locality || '', postalCode: r.postal_code || '', mapsUrl: r.maps_url || '',
  latitude: r.latitude == null ? null : Number(r.latitude), longitude: r.longitude == null ? null : Number(r.longitude),
  coverImageUrl: r.cover_image_url || '', amenities: r.amenities || [],
  closedWeekdays: r.closed_weekdays || [], holidays: r.holidays || [], allowDemoPayments: !!r.allow_demo_payments,
  paymentMode: r.payment_mode || 'none', razorpayKeyId: r.razorpay_key_id || null, createdAt: r.created_at,
})
const mapCourt = (c) => ({
  id: c.id, number: c.number, name: c.name, imageUrl: c.image_url || '', isActive: c.is_active, facilityId: c.facility_id,
  pricePerHour: c.price_per_hour == null ? null : Number(c.price_per_hour), // null = the facility's price
})
const mapBanner = (b) => ({ position: b.position, imageUrl: b.image_url, heading: b.heading || '', description: b.description || '', ctaLabel: b.cta_label || '' })
const mapResult = (r) => ({
  slug: r.slug, name: r.name, tagline: r.tagline, city: r.city, locality: r.locality || '', address: r.address || '', logoUrl: r.logo_url || '',
  coverImageUrl: r.cover_image_url || '', amenities: r.amenities || [], mapsUrl: r.maps_url || '',
  latitude: r.latitude == null ? null : Number(r.latitude), longitude: r.longitude == null ? null : Number(r.longitude),
  minPricePerHour: r.min_price_per_hour == null ? null : Number(r.min_price_per_hour), courtCount: r.court_count,
  distanceKm: r.distance_km == null ? null : Number(r.distance_km), availability: r.availability,
  freeHours: r.free_hours == null ? null : Number(r.free_hours), courtsFreeAtTime: r.courts_free_at_time == null ? null : Number(r.courts_free_at_time),
})

const mapOrder = (r) => {
  const rows = r.bookings || []
  const byId = new Map(rows.map((x) => [x.court_id, x.courts?.number]))
  return {
    id: r.id, facilityId: r.facility_id, reference: r.reference, userId: r.user_id,
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

// owner-editable facility fields: app key → DB key (slug / status / plan / max_courts are deliberately absent)
const FACILITY_FIELDS = {
  name: 'name', tagline: 'tagline', logoUrl: 'logo_url', address: 'address', city: 'city', contactPhone: 'contact_phone',
  contactEmail: 'contact_email', openingTime: 'opening_time', closingTime: 'closing_time', pricePerHour: 'price_per_hour',
  availableDurations: 'available_durations', maxUnpaidHolds: 'max_unpaid_holds', holdMinutes: 'hold_minutes',
  advanceBookingDays: 'advance_booking_days', cancellationPolicy: 'cancellation_policy', closedWeekdays: 'closed_weekdays',
  holidays: 'holidays', allowDemoPayments: 'allow_demo_payments',
  description: 'description', locality: 'locality', postalCode: 'postal_code', mapsUrl: 'maps_url', latitude: 'latitude', longitude: 'longitude',
  coverImageUrl: 'cover_image_url', amenities: 'amenities',
}
const toFacilityJson = (p) => {
  const out = {}
  for (const [k, col] of Object.entries(FACILITY_FIELDS)) if (p[k] !== undefined) out[col] = p[k]
  return out
}

async function fetchOrder(id) {
  return mapOrder(check(await supabase.from('orders').select(ORDER_SELECT).eq('id', id).single()))
}

async function mapUser(authUser) {
  if (!authUser) return null
  const [{ data: p }, { data: admin }] = await Promise.all([
    supabase.from('profiles').select('full_name, phone').eq('id', authUser.id).maybeSingle(),
    supabase.from('platform_admins').select('user_id').eq('user_id', authUser.id).maybeSingle(),
  ])
  return {
    id: authUser.id, email: authUser.email,
    name: p?.full_name || authUser.user_metadata?.full_name || '',
    phone: p?.phone || authUser.user_metadata?.phone || '',
    isPlatformAdmin: !!admin, // display hint only — every platform action is re-checked by the DB
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

let currentFacilityId = null // set by getFacility(); used only to FILTER the player's own order lists

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
    async signUp({ email, password, name, phone, accountType }) {
      const meta = {}
      if (name) meta.full_name = name
      if (phone) meta.phone = phone
      if (accountType) meta.account_type = accountType
      // Owners come back to the setup wizard on the primary domain; players to the facility they were on.
      const back = accountType === 'owner' ? `${window.location.origin}/owner/setup` : `${window.location.origin}${TENANT.basename}/continue`
      const data = check(await supabase.auth.signUp({ email: email.trim(), password, options: { data: meta, emailRedirectTo: back } }))
      return { needsVerification: !data.session }
    },
    async signOut() {
      await supabase.auth.signOut()
    },
    async sendReset(email) {
      check(await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}${TENANT.basename}/auth/reset` }))
    },
    async updatePassword(password) {
      check(await supabase.auth.updateUser({ password }))
    },
  },

  /* ---------------- tenant (player) side ---------------- */
  async getFacility() {
    const j = check(await supabase.rpc('get_facility_public', { p_slug: TENANT.slug }))
    if (!j.facility) return { state: j.state }
    currentFacilityId = j.facility.id
    return { state: j.state, settings: mapFacility(j.facility), courts: j.courts.map(mapCourt), banners: (j.banners || []).map(mapBanner) }
  },

  async publicFacilities() {
    return check(await supabase.rpc('list_public_facilities')).map((r) => ({ slug: r.slug, name: r.name, city: r.city, logoUrl: r.logo_url || '', tagline: r.tagline }))
  },

  /** Public marketplace search (active facilities only). Availability fields are real or null — never guessed. */
  async searchFacilities({ query, date, time, lat, lng } = {}) {
    const rows = check(await supabase.rpc('search_public_facilities', {
      p_query: query || null, p_date: date || null, p_time: time || null, p_lat: lat ?? null, p_lng: lng ?? null,
    }))
    return rows.map(mapResult)
  },

  async getBusy(date) {
    const rows = check(await supabase.rpc('get_busy_slots', { p_slug: TENANT.slug, p_date: date }))
    return rows.map((r) => ({ courtId: r.court_id, start: norm(r.start_time), end: norm(r.end_time), kind: r.kind, mine: r.mine }))
  },

  // Tenant is resolved server-side from the slug; every court is verified to belong to it.
  async createBooking({ courtIds, date, segments, name, phone }) {
    const row = check(await supabase.rpc('create_order', { p_slug: TENANT.slug, p_court_ids: courtIds, p_date: date, p_segments: segments, p_name: name, p_phone: phone }))
    return fetchOrder(row.id)
  },

  async listMyBookings() {
    await supabase.rpc('expire_stale_bookings')
    const { data: auth } = await supabase.auth.getUser()
    let q = supabase.from('orders').select(ORDER_SELECT).eq('user_id', auth.user.id)
    if (currentFacilityId) q = q.eq('facility_id', currentFacilityId)
    return check(await q.order('booking_date', { ascending: false }).order('start_time', { ascending: false })).map(mapOrder)
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
    // The facility decides (settings.paymentMode); this just exposes the actions.
    mode: 'supabase',
    createRazorpayOrder: (orderId) => callFunction('create-razorpay-order', { orderId }),
    verifyRazorpay: (orderId, resp) => callFunction('verify-razorpay-payment', { orderId, ...resp }),
    async demoPay(id) {
      check(await supabase.rpc('demo_pay_order', { p_order_id: id }))
      return fetchOrder(id)
    },
  },

  /* ---------------- facility owner side ---------------- */
  owner: {
    async myFacilities() {
      const { data: auth } = await supabase.auth.getUser()
      const rows = check(await supabase.from('facility_members').select('role, facilities(*)').eq('user_id', auth.user.id))
      return rows.filter((r) => r.facilities).map((r) => ({ ...mapFacility(r.facilities), memberRole: r.role }))
    },
    async facility(fid) {
      const [f, c] = await Promise.all([
        supabase.from('facilities').select('*').eq('id', fid).single(),
        supabase.from('courts').select('*').eq('facility_id', fid).order('number'),
      ])
      const banners = check(await supabase.from('facility_banners').select('*').eq('facility_id', fid).order('position'))
      return { settings: mapFacility(check(f)), courts: check(c).map(mapCourt), banners: banners.map(mapBanner) }
    },
    async checkSlugs(slugs) {
      return check(await supabase.rpc('check_slugs', { p_slugs: slugs })).map((r) => ({ slug: r.slug, available: r.available, reason: r.reason }))
    },
    async createFacility(p) {
      const json = { ...toFacilityJson(p), slug: p.slug, courts: (p.courts || []).map((c) => ({ name: c.name, image_url: c.imageUrl || null, price_per_hour: c.pricePerHour ?? null })) }
      return mapFacility(check(await supabase.rpc('create_facility', { p: json })))
    },
    async updateFacility(fid, p) {
      return mapFacility(check(await supabase.rpc('update_facility', { p_fid: fid, p: toFacilityJson(p) })))
    },
    async addCourt(fid, { name, imageUrl, pricePerHour }) {
      return mapCourt(check(await supabase.from('courts').insert({ facility_id: fid, name: name || null, image_url: imageUrl || null, price_per_hour: pricePerHour ?? null }).select().single()))
    },
    async updateCourt(id, patch) {
      const row = {}
      if (patch.name !== undefined) row.name = patch.name
      if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl || null
      if (patch.isActive !== undefined) row.is_active = patch.isActive
      if (patch.pricePerHour !== undefined) row.price_per_hour = patch.pricePerHour === '' ? null : patch.pricePerHour
      return mapCourt(check(await supabase.from('courts').update(row).eq('id', id).select().single()))
    },
    async removeCourt(id) {
      const { error } = await supabase.from('courts').delete().eq('id', id)
      if (error) throw new Error(error.code === '23503' ? 'court_in_use' : error.message)
    },
    // Images go to the public `facility-media` bucket under <facility-id>/ — Storage RLS only lets that facility's members write there.
    async uploadImage(fid, file, kind = 'image') {
      const { blob, type } = await prepareImage(file)
      const path = `${fid}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      const { error } = await supabase.storage.from('facility-media').upload(path, blob, { contentType: type, upsert: false, cacheControl: '31536000' })
      if (error) throw error
      return supabase.storage.from('facility-media').getPublicUrl(path).data.publicUrl
    },
    async saveBanners(fid, banners) {
      const rows = banners.map((b) => ({ image_url: b.imageUrl, heading: b.heading || null, description: b.description || null, cta_label: b.ctaLabel || null }))
      return check(await supabase.rpc('save_facility_banners', { p_fid: fid, p: rows })).map(mapBanner)
    },
    // The secret goes to an Edge Function that validates it with Razorpay and stores it where
    // no browser role can read it. It is never saved in the facility row or in localStorage.
    savePaymentConfig: (fid, { keyId, keySecret, webhookSecret }) => callFunction('save-payment-config', { facilityId: fid, action: 'save', keyId, keySecret, webhookSecret }),
    removePaymentConfig: (fid) => callFunction('save-payment-config', { facilityId: fid, action: 'remove' }),
  },

  admin: {
    async listBookings(fid) {
      await supabase.rpc('expire_stale_bookings') // release lapsed unpaid holds (idempotent)
      return check(
        await supabase.from('orders').select(ORDER_SELECT).eq('facility_id', fid).order('booking_date', { ascending: false }).order('start_time', { ascending: true }).limit(1000),
      ).map(mapOrder)
    },
    async setStatus(id, status, reason) {
      check(await supabase.rpc('admin_set_order_status', { p_order_id: id, p_status: status, p_reason: reason }))
      return fetchOrder(id)
    },
    async markRefunded(id, note) {
      check(await supabase.rpc('admin_mark_refunded', { p_order_id: id, p_note: note || null }))
      return fetchOrder(id)
    },
    async createBooking({ facilityId, courtIds, date, segments, name, phone, email, confirm, note }) {
      const row = check(
        await supabase.rpc('admin_create_order', {
          p_facility_id: facilityId, p_court_ids: courtIds, p_date: date, p_segments: segments, p_name: name, p_phone: phone,
          p_email: email || null, p_confirm: !!confirm, p_note: note || null,
        }),
      )
      return fetchOrder(row.id)
    },
    async listBlocks(fid) {
      const rows = check(await supabase.from('blocked_slots').select('*').eq('facility_id', fid).order('block_date', { ascending: false }).limit(500))
      return rows.map((r) => ({ id: r.id, facilityId: r.facility_id, courtId: r.court_id, date: r.block_date, start: norm(r.start_time), end: norm(r.end_time), reason: r.reason, createdAt: r.created_at }))
    },
    async createBlock({ courtId, date, start, end, reason }) {
      check(await supabase.rpc('admin_create_block', { p_court_id: courtId, p_date: date, p_start: start, p_end: end, p_reason: reason || null }))
    },
    async removeBlock(id) {
      check(await supabase.rpc('admin_remove_block', { p_block_id: id }))
    },
    async listAudit(fid) {
      const rows = check(await supabase.from('audit_events').select('*').eq('facility_id', fid).order('created_at', { ascending: false }).limit(200))
      return rows.map((r) => ({ id: r.id, actorEmail: r.actor_email, action: r.action, entityType: r.entity_type, details: r.details, createdAt: r.created_at }))
    },
  },

  /* ---------------- platform administrator ---------------- */
  platform: {
    async isAdmin() {
      return !!check(await supabase.rpc('is_platform_admin'))
    },
    async listFacilities() {
      return check(await supabase.rpc('platform_list_facilities')).map((r) => ({
        id: r.id, slug: r.slug, name: r.name, city: r.city, status: r.status, suspendedReason: r.suspended_reason, maxCourts: r.max_courts,
        createdAt: r.created_at, ownerEmail: r.owner_email || '', ownerName: r.owner_name || '', courts: Number(r.courts), orders: Number(r.orders),
        verifiedRevenue: Number(r.verified_revenue),
      }))
    },
    async listOwners() {
      return check(await supabase.rpc('platform_list_owners')).map((r) => ({ userId: r.user_id, email: r.email, fullName: r.full_name, phone: r.phone, facilities: Number(r.facilities) }))
    },
    async metrics() {
      const m = check(await supabase.rpc('platform_metrics'))
      return {
        facilities: m.facilities, facilitiesActive: m.facilities_active, facilitiesPending: m.facilities_pending, facilitiesSuspended: m.facilities_suspended,
        owners: m.owners, players: m.players, ordersTotal: m.orders_total, ordersConfirmed: m.orders_confirmed, ordersLast30d: m.orders_last_30d, verifiedRevenue: Number(m.verified_revenue),
      }
    },
    async setStatus(fid, status, reason) {
      check(await supabase.rpc('platform_set_facility_status', { p_fid: fid, p_status: status, p_reason: reason || null }))
    },
    async setSlug(fid, slug) {
      check(await supabase.rpc('platform_set_slug', { p_fid: fid, p_slug: slug }))
    },
    async setLimits(fid, maxCourts) {
      check(await supabase.rpc('platform_set_facility_limits', { p_fid: fid, p_max_courts: maxCourts }))
    },
    async getSettings() {
      return Object.fromEntries(check(await supabase.rpc('platform_get_settings')).map((r) => [r.key, r.value]))
    },
    async setSetting(key, value) {
      check(await supabase.rpc('platform_set_setting', { p_key: key, p_value: value }))
    },
  },
}
