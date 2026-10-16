import { Link } from 'react-router-dom'
import { ArrowRight, Check, Clock3, X, Circle, Share2 } from 'lucide-react'
import { useToast } from '../context/contexts.js'
import { Badge, StatusBadge } from './ui.jsx'
import { timelineFor } from '../lib/status.js'
import { bookingMinutes, fmtDate, fmtDateTime, fmtDuration, fmtSegments, money } from '../lib/time.js'
import { PAYMENT_STATUS } from '../lib/status.js'

/** Top-down badminton court drawn with SVG — a lightweight stand-in for a photo. */
export function CourtIllustration({ className = '' }) {
  return (
    <svg viewBox="0 0 220 440" className={className} role="img" aria-label="Badminton court, top view" fill="none">
      <rect x="0" y="0" width="220" height="440" rx="18" fill="#122d20" />
      <g stroke="#c6f432" strokeWidth="2.2" strokeLinecap="round">
        <rect x="18" y="22" width="184" height="396" />
        <line x1="34" y1="22" x2="34" y2="418" />
        <line x1="186" y1="22" x2="186" y2="418" />
        <line x1="18" y1="62" x2="202" y2="62" />
        <line x1="18" y1="378" x2="202" y2="378" />
        <line x1="18" y1="150" x2="202" y2="150" />
        <line x1="18" y1="290" x2="202" y2="290" />
        <line x1="110" y1="22" x2="110" y2="150" />
        <line x1="110" y1="290" x2="110" y2="418" />
      </g>
      <line x1="8" y1="220" x2="212" y2="220" stroke="#fff" strokeWidth="3" strokeDasharray="3 5" opacity="0.85" />
      <circle cx="8" cy="220" r="4" fill="#fff" />
      <circle cx="212" cy="220" r="4" fill="#fff" />
    </svg>
  )
}

export function StatusTimeline({ booking }) {
  const steps = timelineFor(booking)
  return (
    <ol className="relative space-y-0" aria-label="Booking progress">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        const style = {
          done: 'bg-forest-900 text-volt-400',
          current: 'bg-volt-400 text-forest-950 ring-4 ring-volt-400/30',
          stopped: 'bg-red-600 text-white',
          todo: 'bg-paper text-muted ring-1 ring-line',
        }[s.state]
        const Icon = { done: Check, current: Clock3, stopped: X, todo: Circle }[s.state]
        return (
          <li key={s.key} className="relative flex gap-4 pb-6 last:pb-0" aria-current={s.state === 'current' ? 'step' : undefined}>
            {!last && <span className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5 ${s.state === 'done' ? 'bg-forest-900' : 'bg-line'}`} aria-hidden />}
            <span className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full ${style}`}><Icon className="size-4" aria-hidden /></span>
            <div className="min-w-0 pt-1">
              <p className={`text-sm font-semibold ${s.state === 'todo' ? 'text-muted' : ''}`}>{s.label}</p>
              {s.at && s.state !== 'todo' && <p className="text-xs text-muted">{fmtDateTime(s.at)}</p>}
              {s.note && <p className="mt-1 text-sm text-muted">{s.note}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function BookingCard({ booking: b, muted }) {
  return (
    <Link to={`/bookings/${b.id}`} className={`card group block p-4 transition-all hover:-translate-y-0.5 hover:shadow-lift sm:p-5 ${muted ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold tracking-wider text-muted">{b.reference}</p>
          <p className="mt-1 font-display text-xl font-bold">{fmtDate(b.date)}</p>
          <p className="text-sm text-muted">{fmtSegments(b)} · Court{b.courtNumbers.length > 1 ? 's' : ''} {b.courtNumbers.join(', ')}</p>
        </div>
        <StatusBadge status={b.status} />
      </div>
      <div className="mt-4 flex items-end justify-between border-t border-line pt-3 text-sm">
        <div className="flex gap-6">
          <div><p className="text-xs text-muted">Total</p><p className="font-semibold">{money(b.totalAmount)}</p></div>
          <div><p className="text-xs text-muted">Payment</p><Badge tone={PAYMENT_STATUS[b.paymentStatus]?.tone}>{PAYMENT_STATUS[b.paymentStatus]?.label}</Badge></div>
        </div>
        <span className="inline-flex items-center gap-1 font-semibold text-forest-600 group-hover:gap-2">Details <ArrowRight className="size-4 transition-all" aria-hidden /></span>
      </div>
    </Link>
  )
}

/** Share icon: native share sheet when available, otherwise copies the details + link. */
export function ShareBooking({ booking: b, facilityName, className = '' }) {
  const toast = useToast()
  const share = async () => {
    const courts = `Court${b.courtNumbers.length > 1 ? 's' : ''} ${b.courtNumbers.join(', ')}`
    const text = `${facilityName} — ${courts}\n${fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmtSegments(b)} (${fmtDuration(bookingMinutes(b))})\nBooking ref: ${b.reference}`
    const url = `${window.location.origin}/`
    if (navigator.share) {
      try {
        await navigator.share({ title: `${facilityName} booking`, text, url })
        return
      } catch (e) {
        if (e?.name === 'AbortError') return // the user closed the share sheet
        // any other failure: fall back to copying
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`)
      toast('Booking details copied — paste them anywhere to share')
    } catch {
      toast('Couldn’t share or copy. Please note down your booking reference.', 'error')
    }
  }
  return (
    <button onClick={share} aria-label="Share booking" title="Share booking"
      className={`grid size-11 place-items-center rounded-full border border-line bg-white text-ink transition-colors hover:bg-paper ${className}`}>
      <Share2 className="size-5" aria-hidden />
    </button>
  )
}
