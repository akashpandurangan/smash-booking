import { toMin, todayISO, nowMinutes } from './time.js'

/**
 * Availability of one court for [start,end) on `date`.
 * Priority: blocked > confirmed > pending. Returns { state, mine }.
 * state: 'available' | 'pending' | 'booked' | 'blocked' | 'past' | 'inactive'
 * This drives the UI only — the database is the source of truth and re-checks on booking.
 */
export function courtState({ court, busy, start, end, date, settings }) {
  if (!court.isActive) return { state: 'inactive', mine: false }
  if (date === todayISO(settings.timezone) && toMin(start) <= nowMinutes(settings.timezone)) {
    return { state: 'past', mine: false }
  }
  const s = toMin(start)
  const e = toMin(end)
  const hits = busy.filter((b) => b.courtId === court.id && toMin(b.start) < e && toMin(b.end) > s)
  if (hits.some((h) => h.kind === 'blocked')) return { state: 'blocked', mine: false }
  const confirmed = hits.find((h) => h.kind === 'confirmed')
  if (confirmed) return { state: 'booked', mine: confirmed.mine }
  const pending = hits.find((h) => h.kind === 'pending')
  if (pending) return { state: 'pending', mine: pending.mine }
  return { state: 'available', mine: false }
}
