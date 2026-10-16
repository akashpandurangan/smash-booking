import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarX2, CalendarPlus, LogIn, Phone, Mail, Ticket } from 'lucide-react'
import { useAuth, useFacility, useToast } from '../context/contexts.js'
import { api } from '../lib/api/index.js'
import { friendlyError } from '../lib/errors.js'
import { fmtDateLong, fmtDateTime, fmtRange, isPast, money, fmtSegments } from '../lib/time.js'
import { PAYMENT_STATUS } from '../lib/status.js'
import { Alert, Badge, Button, ConfirmDialog, DetailRow, EmptyState, Skeleton, StatusBadge } from '../components/ui.jsx'
import { BookingCard, StatusTimeline } from '../components/Bits.jsx'

function LoginPrompt({ from }) {
  return (
    <div className="container-page max-w-xl py-12">
      <EmptyState icon={LogIn} title="Log in to see your bookings" action={<Button to="/auth" state={{ from }}>Log in or sign up</Button>}>
        Your bookings are private to your account. You can still browse courts without logging in.
      </EmptyState>
    </div>
  )
}

export function MyBookingsPage() {
  const { user, loading: authLoading } = useAuth()
  const { settings } = useFacility()
  const loc = useLocation()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try { setItems(await api.listMyBookings()) } catch (e) { setError(friendlyError(e)) }
  }, [])
  useEffect(() => { if (user) load() }, [user, load])

  const groups = useMemo(() => {
    const g = { pending: [], upcoming: [], past: [], cancelled: [] }
    if (!items || !settings) return g
    const asc = [...items].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    for (const b of asc) {
      if (b.status === 'cancelled' || b.status === 'expired') g.cancelled.push(b)
      else if (isPast(b, settings.timezone)) g.past.push(b)
      else if (b.status === 'confirmed') g.upcoming.push(b)
      else g.pending.push(b)
    }
    g.past.reverse(); g.cancelled.reverse()
    return g
  }, [items, settings])

  if (authLoading) return <div className="container-page py-10"><Skeleton className="h-64" /></div>
  if (!user) return <LoginPrompt from={loc.pathname} />

  const TABS = [
    ['pending', 'Pending'],
    ['upcoming', 'Confirmed'],
    ['past', 'Past'],
    ['cancelled', 'Cancelled'],
  ]
  const active = tab || (groups.pending.length ? 'pending' : groups.upcoming.length ? 'upcoming' : groups.past.length ? 'past' : 'upcoming')
  const list = groups[active]
  const empty = {
    pending: ['Nothing waiting on you', 'Bookings awaiting payment will show up here.'],
    upcoming: ['No confirmed bookings yet', 'Once your payment is verified, your upcoming games appear here.'],
    past: ['No past bookings', 'Your completed games will be listed here.'],
    cancelled: ['No cancelled bookings', 'Cancelled or expired holds will be listed here.'],
  }[active]

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">My bookings</h1>
          <p className="mt-1 text-muted">Track payment and confirmation status.</p>
        </div>
        <Button to="/" size="sm" variant="dark"><CalendarPlus className="size-4" aria-hidden />New</Button>
      </div>

      <div className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 no-scrollbar" role="tablist" aria-label="Booking groups">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={active === k} onClick={() => setTab(k)}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${active === k ? 'bg-forest-900 text-white' : 'border border-line bg-white hover:border-forest-600'}`}>
            {label}
            <span className={`rounded-full px-1.5 text-xs ${active === k ? 'bg-volt-400 text-forest-950' : 'bg-paper text-muted'}`}>{groups[k].length}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3" role="tabpanel">
        {error && <Alert tone="error">{error} <button className="font-semibold underline" onClick={load}>Retry</button></Alert>}
        {!items && !error && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36" />)}
        {items && !list.length && (
          <EmptyState icon={active === 'cancelled' ? CalendarX2 : Ticket} title={empty[0]} action={<Button to="/">Book a court</Button>}>{empty[1]}</EmptyState>
        )}
        {list.map((b) => <BookingCard key={b.id} booking={b} muted={active === 'past' || active === 'cancelled'} />)}
      </div>
    </div>
  )
}

export function BookingDetailPage() {
  const { id } = useParams()
  const { user, loading: authLoading } = useAuth()
  const { settings } = useFacility()
  const toast = useToast()
  const loc = useLocation()
  const [b, setB] = useState(null)
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => {
    if (!user) return
    api.getMyBooking(id).then(setB).catch((e) => setError(friendlyError(e)))
  }, [id, user])

  if (authLoading) return <div className="container-page py-10"><Skeleton className="h-64" /></div>
  if (!user) return <Navigate to="/auth" state={{ from: loc.pathname }} replace />

  const back = <Link to="/bookings" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />All bookings</Link>
  if (error) return <div className="container-page max-w-2xl py-10">{back}<Alert tone="error">{error}</Alert></div>
  if (!b || !settings) return <div className="container-page max-w-2xl space-y-4 py-10"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>

  const past = isPast(b, settings.timezone)
  const canPay = b.status === 'pending_payment' && !(b.expiresAt && new Date(b.expiresAt) < new Date())
  const courtsText = `Court${b.courtNumbers.length > 1 ? 's' : ''} ${b.courtNumbers.join(', ')}`
  const cancel = async () => {
    setB(await api.cancelMyBooking(b.id))
    setConfirmCancel(false)
    toast('Booking cancelled')
  }

  return (
    <div className="container-page max-w-2xl py-8 sm:py-12">
      {back}
      <div className="card overflow-hidden">
        <div className="on-dark bg-forest-900 p-5 text-white sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs tracking-widest text-white/60">{b.reference}</p>
              <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{courtsText}</h1>
              <p className="mt-1 text-white/80">{fmtDateLong(b.date)}</p>
              <p className="font-display text-xl font-bold text-volt-400">{fmtSegments(b)}</p>
            </div>
            <StatusBadge status={b.status} />
          </div>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          {b.status === 'confirmed' && !past && <Alert tone="success" title="You’re booked in!">Your payment is verified. Show your booking reference at the venue if asked.</Alert>}
          {b.needsRefund && <Alert tone="warn" title="Refund pending">We received your payment but couldn’t keep the courts for you. The facility will refund you — contact them with reference {b.reference}.</Alert>}
          {canPay && <Alert tone="warn" title="Payment needed">Complete your payment to secure {b.courtNumbers.length > 1 ? 'these courts' : 'this court'}.</Alert>}

          <section>
            <h2 className="mb-4 text-lg font-bold">Progress</h2>
            <StatusTimeline booking={b} />
          </section>

          <section>
            <h2 className="mb-1 text-lg font-bold">Payment</h2>
            <dl className="divide-y divide-line">
              <DetailRow label="Total amount">{money(b.totalAmount)}</DetailRow>
              <DetailRow label="Payment status"><Badge tone={PAYMENT_STATUS[b.paymentStatus]?.tone}>{PAYMENT_STATUS[b.paymentStatus]?.label}</Badge></DetailRow>
              {b.paidAt && <DetailRow label="Paid on">{fmtDateTime(b.paidAt)}</DetailRow>}
            </dl>
          </section>

          <section>
            <h2 className="mb-1 text-lg font-bold">Booked by</h2>
            <dl className="divide-y divide-line">
              <DetailRow label="Name">{b.customerName}</DetailRow>
              <DetailRow label="Mobile">{b.customerPhone}</DetailRow>
            </dl>
          </section>

          <section className="rounded-xl bg-paper p-4 text-sm">
            <h2 className="font-bold">Cancellation & contact</h2>
            <p className="mt-1 text-muted">{settings.cancellationPolicy}</p>
            <ul className="mt-2 space-y-1 text-muted">
              <li className="flex items-center gap-2"><Phone className="size-4" aria-hidden />{settings.contactPhone || 'Phone not set yet'}</li>
              <li className="flex items-center gap-2"><Mail className="size-4" aria-hidden />{settings.contactEmail || 'Email not set yet'}</li>
            </ul>
          </section>

          <div className="flex flex-col gap-2 sm:flex-row">
            {canPay && <Button to={`/pay/${b.id}`} className="flex-1">Pay {money(b.totalAmount)}</Button>}
            {b.status === 'pending_payment' && <Button variant="dangerOutline" className="flex-1" onClick={() => setConfirmCancel(true)}>Cancel this hold</Button>}
            {(b.status === 'expired' || b.status === 'cancelled') && <Button to="/" className="flex-1">Book another slot</Button>}
          </div>
        </div>
      </div>

      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel this booking?" tone="danger" confirmLabel="Yes, cancel"
        message="The slot will be released for others. This can’t be undone." onConfirm={cancel} />
    </div>
  )
}
