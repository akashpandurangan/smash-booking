const pad = (n) => String(n).padStart(2, '0')

export const norm = (t) => (t ? String(t).slice(0, 5) : t)
export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

export function fmt12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${suffix}`
}
export const fmtRange = (s, e) => `${fmt12(s)}–${fmt12(e)}`

/** Compact range: same meridiem collapses -> '3:00–3:30 PM'; otherwise '11:30 AM–12:00 PM'. */
export function fmtRangeShort(s, e) {
  const a = fmt12(s)
  const b = fmt12(e)
  if (a.slice(-2) === b.slice(-2)) return `${a.slice(0, -3)}–${b}`
  return `${a}–${b.replace(':00', '')}` // 11:30 AM–12 PM (keeps phone chips from wrapping)
}

/** A booking is a list of separate time ranges (older data: a single start/end). */
export const bookingSegments = (b) => (b.segments?.length ? b.segments : [{ start: b.start, end: b.end }])
export const fmtSegments = (b) => bookingSegments(b).map((g) => fmtRange(g.start, g.end)).join(', ')
export const bookingMinutes = (b) => bookingSegments(b).reduce((m, g) => m + toMin(g.end) - toMin(g.start), 0)

/** Merge a sorted list of slot objects [{start,end}] into contiguous ranges. */
export function mergeSlots(list) {
  const out = []
  for (const s of list) {
    const last = out[out.length - 1]
    if (last && last.end === s.start) last.end = s.end
    else out.push({ start: s.start, end: s.end })
  }
  return out
}

/** 90 -> '1 hr 30 min', 30 -> '30 min', 120 -> '2 hrs' */
export function fmtDuration(mins) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const hs = h ? `${h} hr${h > 1 ? 's' : ''}` : ''
  const ms = m ? `${m} min` : ''
  return [hs, ms].filter(Boolean).join(' ')
}

/** All slot start/end pairs between opening and closing, using the configured slot length. */
export function generateSlots(settings) {
  const out = []
  const open = toMin(norm(settings.openingTime))
  const close = toMin(norm(settings.closingTime))
  for (let t = open; t + settings.slotMinutes <= close; t += settings.slotMinutes) {
    out.push({ start: fromMin(t), end: fromMin(t + settings.slotMinutes) })
  }
  return out
}

export function todayISO(tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
}
export function nowMinutes(tz = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date())
  const h = Number(parts.find((p) => p.type === 'hour').value) % 24
  const m = Number(parts.find((p) => p.type === 'minute').value)
  return h * 60 + m
}
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dateFrom = (iso) => new Date(`${iso}T00:00:00`)
export const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  dateFrom(iso).toLocaleDateString('en-IN', opts)
export const fmtDateLong = (iso) =>
  fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const fmtDateTime = (isoTs) =>
  new Date(isoTs).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function money(n) {
  const v = Number(n || 0)
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Closed on a weekly day off or a listed holiday (iso = YYYY-MM-DD). */
export function isClosedDay(settings, iso) {
  const dow = new Date(`${iso}T00:00:00`).getDay()
  return (settings.closedWeekdays || []).includes(dow) || (settings.holidays || []).includes(iso)
}

/** True once the booking's end time has passed in the facility timezone. */
export function isPast(b, tz) {
  const today = todayISO(tz)
  if (b.date < today) return true
  return b.date === today && toMin(b.end) <= nowMinutes(tz)
}
