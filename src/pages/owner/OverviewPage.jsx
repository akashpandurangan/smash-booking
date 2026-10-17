import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BadgeIndianRupee, CalendarCheck, CalendarClock, ChevronRight, ClipboardCheck, LayoutGrid, Undo2 } from 'lucide-react'
import { useFacility } from '../../context/contexts.js'
import { useAdmin } from './OwnerLayout.jsx'
import { bookingMinutes, fmtDate, fmtSegments, generateSlots, money, todayISO } from '../../lib/time.js'
import { ACTIVE_STATUSES, PAYMENT_STATUS } from '../../lib/status.js'
import { Badge, EmptyState, Skeleton, Stat, StatusBadge } from '../../components/ui.jsx'
import BookingModal from './BookingModal.jsx'
import LinkActions from '../../components/LinkActions.jsx'
import { bookingUrl, workingUrl } from '../../lib/tenant.js'

const courtsText = (b) => `Court${b.courtNumbers.length > 1 ? 's' : ''} ${b.courtNumbers.join(', ')}`

export default function OverviewPage() {
  const { bookings, blocks, reload } = useAdmin()
  const { settings, courts } = useFacility()
  const [open, setOpen] = useState(null)

  const m = useMemo(() => {
    if (!bookings || !settings) return null
    const today = todayISO(settings.timezone)
    const active = bookings.filter((b) => ACTIVE_STATUSES.includes(b.status))
    const todays = active.filter((b) => b.date === today)
    const confirmed = active.filter((b) => b.status === 'confirmed' && b.date >= today)
    const awaiting = bookings.filter((b) => b.status === 'pending_payment').sort((a, b) => (a.expiresAt || '').localeCompare(b.expiresAt || ''))
    const refunds = bookings.filter((b) => b.needsRefund)
    // Money actually verified through Razorpay (not demo / venue payments, not refunded)
    const verified = bookings.filter((b) => b.paymentStatus === 'paid' && !b.needsRefund).reduce((s, b) => s + b.totalAmount, 0)
    const perDay = generateSlots(settings).length
    const totalSlots = courts.filter((c) => c.isActive).length * perDay
    const slotsOf = (x) => (bookingMinutes(x) / settings.slotMinutes) * (x.courtIds?.length ?? 1)
    const occupied = todays.reduce((s, b) => s + slotsOf(b), 0) + blocks.filter((k) => k.date === today).reduce((s, k) => s + slotsOf(k), 0)
    return { today, todays, confirmed, awaiting, refunds, verified, totalSlots, occupied: Math.min(occupied, totalSlots) }
  }, [bookings, blocks, settings, courts])

  if (!m) return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
  const pct = m.totalSlots ? Math.round((m.occupied / m.totalSlots) * 100) : 0
  const live = bookings.find((b) => b.id === open?.id)

  const Row = ({ b, right }) => (
    <li>
      <button onClick={() => setOpen(b)} className="card flex w-full items-center gap-3 p-4 text-left transition-shadow hover:shadow-lift">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{b.customerName} <span className="font-mono text-xs font-normal text-muted">{b.reference}</span></p>
          <p className="text-sm text-muted">{courtsText(b)} · {fmtDate(b.date)} · {fmtSegments(b)}</p>
        </div>
        <div className="text-right"><p className="font-bold">{money(b.totalAmount)}</p>{right}</div>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
    </li>
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">Overview</h1>
        <p className="text-muted">{fmtDate(m.today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      <section className="card p-4 sm:p-5" aria-label="Your booking link">
        <p className="text-sm text-muted">Your booking link</p>
        <p className="mt-0.5 break-all font-display text-xl font-bold">{bookingUrl(settings.slug)}</p>
        <LinkActions className="mt-3" url={bookingUrl(settings.slug)} previewUrl={workingUrl(settings.slug)} name={settings.name} />
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <Stat icon={CalendarClock} label="Today’s bookings" value={m.todays.length} hint="Active bookings today" />
        <Stat icon={ClipboardCheck} label="Awaiting payment" value={m.awaiting.length} hint="Courts currently on hold" />
        <Stat icon={CalendarCheck} label="Confirmed upcoming" value={m.confirmed.length} />
        <Stat icon={BadgeIndianRupee} label="Online payments verified" value={money(m.verified)} hint="Razorpay, excluding refunds" />
        <div className="card col-span-2 p-4 sm:p-5 xl:col-span-2">
          <div className="flex items-center gap-2 text-sm text-muted"><LayoutGrid className="size-4" aria-hidden />Court slots today</div>
          <p className="mt-2 font-display text-3xl font-extrabold">{m.totalSlots - m.occupied} <span className="text-lg font-semibold text-muted">available · {m.occupied} occupied</span></p>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-paper" role="img" aria-label={`${pct}% of today's slots occupied`}>
            <div className="h-full rounded-full bg-volt-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted">{pct}% of {m.totalSlots} {settings.slotMinutes}-minute court slots (incl. blocks)</p>
        </div>
      </div>

      {m.refunds.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-xl font-bold text-red-800"><Undo2 className="size-5" aria-hidden />Refunds needed</h2>
          <ul className="space-y-2">{m.refunds.map((b) => <Row key={b.id} b={b} right={<Badge tone="red">Refund due</Badge>} />)}</ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Awaiting payment</h2>
          <Link to="/admin/bookings" className="text-sm font-semibold text-forest-600 hover:underline">All bookings</Link>
        </div>
        {!m.awaiting.length ? (
          <EmptyState icon={ClipboardCheck} title="Nothing on hold">Unpaid holds appear here until they’re paid or expire.</EmptyState>
        ) : (
          <ul className="space-y-2">{m.awaiting.map((b) => <Row key={b.id} b={b} right={<StatusBadge status={b.status} />} />)}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Today’s schedule</h2>
        {!m.todays.length ? <p className="text-sm text-muted">No bookings today.</p> : (
          <ul className="card divide-y divide-line">
            {[...m.todays].sort((a, b) => a.start.localeCompare(b.start)).map((b) => (
              <li key={b.id}>
                <button onClick={() => setOpen(b)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper">
                  <span className="w-28 shrink-0 text-xs font-semibold sm:w-44 sm:text-sm">{fmtSegments(b)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{courtsText(b)} · {b.customerName}</span>
                  <Badge tone={PAYMENT_STATUS[b.paymentStatus]?.tone}>{PAYMENT_STATUS[b.paymentStatus]?.label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BookingModal booking={live} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  )
}
