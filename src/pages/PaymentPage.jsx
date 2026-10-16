import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BadgeCheck, CalendarDays, FlaskConical, Hourglass, Lock, Ticket, Timer } from 'lucide-react'
import { api } from '../lib/api/index.js'
import { isDemo } from '../lib/config.js'
import { useAuth, useFacility, useToast } from '../context/contexts.js'
import { friendlyError } from '../lib/errors.js'
import { PAYMENT_STATUS } from '../lib/status.js'
import { bookingMinutes, fmtDateLong, fmtDuration, fmtSegments, money } from '../lib/time.js'
import { Alert, Badge, Button, DetailRow, Skeleton, StatusBadge } from '../components/ui.jsx'
import { ShareBooking } from '../components/Bits.jsx'

const courtsLabel = (b) => `Court${b.courtNumbers.length > 1 ? 's' : ''} ${b.courtNumbers.join(', ')}`

function Countdown({ until, onDone }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(until) - Date.now()))
  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, new Date(until) - Date.now())
      setLeft(l)
      if (l === 0) { clearInterval(t); onDone?.() }
    }, 1000)
    return () => clearInterval(t)
  }, [until, onDone])
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return <span className="font-mono tabular-nums">{m}:{String(s).padStart(2, '0')}</span>
}

let razorpayScript
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve()
  razorpayScript ||= new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = 'https://checkout.razorpay.com/v1/checkout.js'
    el.onload = resolve
    el.onerror = () => { razorpayScript = null; reject(new Error('Could not load the payment window. Check your connection and try again.')) }
    document.head.appendChild(el)
  })
  return razorpayScript
}

export default function PaymentPage() {
  const { id } = useParams()
  const { settings } = useFacility()
  const { user } = useAuth()
  const toast = useToast()
  const [b, setB] = useState(null)
  const [error, setError] = useState('')
  const [payError, setPayError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setB(await api.getMyBooking(id)) } catch (e) { setError(friendlyError(e)) }
  }, [id])
  useEffect(() => { load() }, [load])

  if (error) return <div className="container-page max-w-xl py-12"><Alert tone="error">{error}</Alert><Button to="/bookings" variant="dark" className="mt-4">My bookings</Button></div>
  if (!b || !settings) return <div className="container-page max-w-xl space-y-4 py-10"><Skeleton className="h-40" /><Skeleton className="h-72" /></div>

  const holdLeft = b.expiresAt ? new Date(b.expiresAt) - Date.now() : null
  const expired = b.status === 'expired' || (b.status === 'pending_payment' && holdLeft !== null && holdLeft <= 0)
  const mode = api.payment.mode // 'razorpay' | 'demo'
  // Outside local demo mode the test payment only works if the owner switched it on.
  const demoBlocked = mode === 'demo' && !isDemo && !settings.allowDemoPayments

  const pay = async () => {
    setBusy(true); setPayError('')
    try {
      if (mode === 'razorpay') {
        const info = await api.payment.createRazorpayOrder(b.id)
        await loadRazorpay()
        await new Promise((resolve, reject) => {
          const rz = new window.Razorpay({
            key: info.keyId, amount: info.amount, currency: info.currency, order_id: info.razorpayOrderId,
            name: settings.name, description: `${courtsLabel(b)} · ${fmtDateLong(b.date)} · ${fmtSegments(b)}`,
            prefill: { name: b.customerName, email: user?.email, contact: b.customerPhone },
            notes: { reference: b.reference }, theme: { color: '#0c1f17' },
            // Booking is confirmed only after OUR server verifies this response.
            handler: (resp) => api.payment.verifyRazorpay(b.id, resp).then(resolve, reject),
            modal: { ondismiss: () => reject(new Error('cancelled')) },
          })
          rz.on('payment.failed', (r) => reject(new Error(r.error?.description || 'The payment failed. You have not been charged.')))
          rz.open()
        })
        toast('Payment verified — booking confirmed')
      } else {
        await api.payment.demoPay(b.id)
        toast('Demo payment complete')
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      setPayError(e.message === 'cancelled' ? 'Payment window closed. You can try again while your courts are held.' : friendlyError(e))
    } finally {
      setBusy(false)
      load() // always re-read the truth from the server (a webhook may have confirmed it)
    }
  }

  const summary = (
    <dl className="divide-y divide-line">
      <DetailRow label="Booking reference"><span className="font-mono">{b.reference}</span></DetailRow>
      <DetailRow label="Date">{fmtDateLong(b.date)}</DetailRow>
      <DetailRow label="Time">{fmtSegments(b)}</DetailRow>
      <DetailRow label="Duration">{fmtDuration(bookingMinutes(b))}</DetailRow>
      <DetailRow label={b.courtNumbers.length > 1 ? 'Courts' : 'Court'}>{b.courtNumbers.join(', ')}</DetailRow>
      <DetailRow label="Total amount"><strong>{money(b.totalAmount)}</strong></DetailRow>
      <DetailRow label="Payment status"><Badge tone={PAYMENT_STATUS[b.paymentStatus]?.tone}>{PAYMENT_STATUS[b.paymentStatus]?.label}</Badge></DetailRow>
    </dl>
  )

  /* ---- confirmation / resolved states ---- */
  if (b.status !== 'pending_payment' || expired) {
    const confirmed = b.status === 'confirmed'
    return (
      <div className="container-page max-w-xl py-8 sm:py-12">
        <div className="card rise relative p-6 text-center sm:p-8">
          {confirmed && <ShareBooking booking={b} facilityName={settings.name} className="absolute right-4 top-4" />}
          <span className={`mx-auto grid size-14 place-items-center rounded-2xl ${confirmed ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {confirmed ? <BadgeCheck className="size-7" aria-hidden /> : <Hourglass className="size-7" aria-hidden />}
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">{confirmed ? 'Booking confirmed!' : expired ? 'This hold has expired' : 'Booking cancelled'}</h1>
          <div className="mt-2 flex justify-center"><StatusBadge status={expired ? 'expired' : b.status} /></div>
          {confirmed && <p className="mt-4 text-muted">See you on court. Keep your booking reference handy — you can always find this booking in My Bookings.</p>}
          {expired && <p className="mt-4 text-muted">The unpaid hold ran out and the courts were released. You can book again if they’re still free.</p>}
          {b.needsRefund && <Alert tone="warn" className="mt-4 text-left" title="Refund pending">We received your payment but couldn’t keep the courts for you. The facility will refund you — contact them with reference {b.reference} if you don’t hear back.</Alert>}
        </div>
        <section className="card mt-4 p-5" aria-label="Booking details">{summary}</section>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button to="/bookings" variant="dark"><Ticket className="size-4" aria-hidden />Go to My Bookings</Button>
          <Button to={confirmed ? `/bookings/${b.id}` : '/'} variant="outline">{confirmed ? 'View booking details' : 'Book again'}</Button>
        </div>
      </div>
    )
  }

  /* ---- pay now ---- */
  return (
    <div className="container-page max-w-4xl py-8 sm:py-12">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Complete your payment</h1>
      <p className="mt-1 text-muted">Your booking is confirmed as soon as the payment is verified.</p>

      {b.expiresAt && (
        <Alert tone="warn" className="mt-5">
          <span><Timer className="mr-2 inline size-4 align-text-bottom" aria-hidden />{courtsLabel(b)} held for <strong><Countdown until={b.expiresAt} onDone={load} /></strong>. Pay before the timer ends.</span>
        </Alert>
      )}

      <div className="mt-6 grid items-start gap-6 md:grid-cols-[1.2fr_1fr]">
        <section className="card p-5 sm:p-6">
          <div className="rounded-2xl bg-forest-900 p-5 text-white">
            <p className="text-sm text-white/70">Total to pay</p>
            <p className="font-display text-4xl font-extrabold text-volt-400">{money(b.totalAmount)}</p>
            <p className="mt-1 text-sm text-white/70">{courtsLabel(b)} · {fmtDateLong(b.date)} · {fmtSegments(b)}</p>
          </div>

          {mode === 'demo' && (
            <Alert tone="info" className="mt-4" title={<span className="inline-flex items-center gap-1.5"><FlaskConical className="size-4" aria-hidden />Demo payment — no real money</span>}>
              {isDemo
                ? 'Razorpay isn’t configured, so this is a pretend payment. Nothing is charged and no gateway is contacted.'
                : demoBlocked
                  ? 'Online payment isn’t set up yet. Please contact the facility to complete this booking.'
                  : 'Razorpay isn’t configured. The owner has enabled test payments, so this confirms without charging anything.'}
            </Alert>
          )}
          {payError && <Alert tone="error" className="mt-4">{payError}</Alert>}

          <Button size="lg" className="mt-4 w-full" onClick={pay} loading={busy} disabled={demoBlocked}>
            {mode === 'razorpay' ? <><Lock className="size-4" aria-hidden />Pay {money(b.totalAmount)} securely</> : <>Simulate payment · {money(b.totalAmount)}</>}
          </Button>
          <p className="mt-3 text-center text-xs text-muted">
            {mode === 'razorpay' ? 'Payments are processed by Razorpay. We never see or store your card, UPI PIN or bank details.' : 'Demo flow only — it does not process real money.'}
          </p>
        </section>

        <aside className="card p-5 md:sticky md:top-24" aria-label="Booking summary">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-bold"><CalendarDays className="size-5" aria-hidden />Your booking</h2>
          {summary}
          <Link to={`/bookings/${b.id}`} className="mt-3 block text-sm font-medium text-forest-600 hover:underline">View booking details</Link>
        </aside>
      </div>
    </div>
  )
}
