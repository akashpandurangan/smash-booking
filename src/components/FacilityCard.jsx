import { ArrowRight, MapPin, Navigation, Store } from 'lucide-react'
import { AMENITY_LABEL } from '../lib/amenities.js'
import { directionsUrl } from '../lib/maps.js'
import { fmt12, fmtDate, money } from '../lib/time.js'
import { workingUrl } from '../lib/tenant.js'
import { Badge } from './ui.jsx'

/** One sentence about availability — only ever derived from the database's answer, never guessed. */
export function availabilityNote(f, date, time) {
  const day = date ? fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short' }) : ''
  switch (f.availability) {
    case 'open':
      if (time && f.courtsFreeAtTime != null) {
        return f.courtsFreeAtTime > 0
          ? { tone: 'lime', text: `${f.courtsFreeAtTime} court${f.courtsFreeAtTime > 1 ? 's' : ''} free at ${fmt12(time)} · ${day}` }
          : { tone: 'slate', text: `No court free at ${fmt12(time)} · ${day}` }
      }
      return f.freeHours > 0
        ? { tone: 'lime', text: `${Math.round(f.freeHours)} hourly slot${Math.round(f.freeHours) === 1 ? '' : 's'} open · ${day}` }
        : { tone: 'slate', text: `Fully booked · ${day}` }
    case 'closed':
      return { tone: 'slate', text: `Closed on ${day}` }
    case 'unverifiable':
      return { tone: 'amber', text: 'Availability for this date can’t be checked here — open the page to see slots' }
    default:
      return null
  }
}

/** Cover photo (16:9) or an honest "no photo yet" tile — never a stock image passed off as the venue. */
function Cover({ f }) {
  if (f.coverImageUrl) {
    return <img src={f.coverImageUrl} alt={`${f.name} courts`} width="640" height="360" loading="lazy" decoding="async" className="aspect-video w-full bg-paper object-cover" />
  }
  return (
    <div className="grid aspect-video w-full place-items-center bg-forest-800 text-white/80" role="img" aria-label={`${f.name} — no photo added yet`}>
      <div className="text-center">
        <Store className="mx-auto size-8 text-volt-400" aria-hidden />
        <p className="mt-1 text-xs">Photo not added yet</p>
      </div>
    </div>
  )
}

export default function FacilityCard({ facility: f, date, time }) {
  const note = availabilityNote(f, date, time)
  const place = [f.locality, f.city].filter(Boolean).join(', ')
  const directions = directionsUrl(f)
  const shown = f.amenities.slice(0, 3)
  return (
    <article className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-lift">
      <Cover f={f} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg font-bold">{f.name}</h3>
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted"><MapPin className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{place || 'Location not set yet'}</span></p>
          </div>
          {f.distanceKm != null && <Badge tone="slate" className="shrink-0">{f.distanceKm} km</Badge>}
        </div>

        <p className="mt-3 text-sm">
          {f.minPricePerHour != null ? <><span className="text-muted">From </span><strong className="font-display text-lg">{money(f.minPricePerHour)}</strong><span className="text-muted"> / hour</span></> : <span className="text-muted">Pricing not set yet</span>}
          <span className="text-muted"> · {f.courtCount} court{f.courtCount === 1 ? '' : 's'}</span>
        </p>

        {note && <p className="mt-2"><Badge tone={note.tone} className="whitespace-normal text-left">{note.text}</Badge></p>}

        {shown.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Amenities">
            {shown.map((a) => <li key={a} className="rounded-full bg-paper px-2.5 py-1 text-xs text-muted">{AMENITY_LABEL[a] || a}</li>)}
            {f.amenities.length > shown.length && <li className="rounded-full bg-paper px-2.5 py-1 text-xs text-muted">+{f.amenities.length - shown.length} more</li>}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
          <a href={workingUrl(f.slug)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-forest-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-forest-800 sm:flex-none">
            View courts <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </a>
          {directions && (
            <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest-600 hover:underline">
              <Navigation className="size-4" aria-hidden />Get directions<span className="sr-only"> to {f.name} (opens Google Maps)</span>
            </a>
          )}
        </div>
      </div>
    </article>
  )
}
