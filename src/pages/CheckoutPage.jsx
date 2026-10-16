import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarDays, Clock, Info, MapPin, Pencil, UserRound } from 'lucide-react'
import { useAuth, useFacility } from '../context/contexts.js'
import { api } from '../lib/api/index.js'
import { courtState } from '../lib/availability.js'
import { friendlyError } from '../lib/errors.js'
import { clearDraft, loadDraft } from '../lib/draft.js'
import { bookingMinutes, fmtDateLong, fmtDuration, fmtRange, fromMin, money, toMin } from '../lib/time.js'
import { Alert, Button, DetailRow, EmptyState, Field, Skeleton } from '../components/ui.jsx'

const cleanPhone = (p) => String(p || '').replace(/\D/g, '')
const validName = (n) => String(n || '').trim().length >= 2
const validPhone = (p) => /^\d{10,15}$/.test(cleanPhone(p))

export default function CheckoutPage() {
  const { user, loading: authLoading } = useAuth()
  const { settings, courts, loading: facLoading } = useFacility()
  const nav = useNavigate()
  const [draft] = useState(loadDraft)
  const [check, setCheck] = useState({ state: 'checking', message: '' })
  const [form, setForm] = useState({ name: '', phone: '' })
  const [editing, setEditing] = useState(false)
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user) setForm((f) => ({ name: f.name || user.name || '', phone: f.phone || user.phone || '' }))
  }, [user])

  // Drafts saved before multi-range support have a single start/end.
  const segments = draft ? (draft.segments?.length ? draft.segments : [{ start: draft.start, end: draft.end || (settings ? fromMin(toMin(draft.start) + settings.slotMinutes) : draft.start) }]) : []

  // Re-verify EVERY selected court is still free for EVERY selected range (e.g. after a login redirect).
  useEffect(() => {
    if (!draft?.courtIds?.length || !settings || !courts.length || !user) return
    let alive = true
    api.getBusy(draft.date).then((busy) => {
      if (!alive) return
      const gone = draft.courtIds.filter((id) => {
        const court = courts.find((c) => c.id === id)
        return !court || segments.some((g) => courtState({ court, busy, start: g.start, end: g.end, date: draft.date, settings }).state !== 'available')
      })
      setCheck(gone.length
        ? { state: 'gone', message: gone.length === draft.courtIds.length ? 'The courts you picked are no longer available at these times.' : 'One or more of the courts you picked is no longer available at these times.' }
        : { state: 'ok' })
    }).catch((e) => alive && setCheck({ state: 'error', message: friendlyError(e) }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, settings, courts, user])

  if (!draft?.courtIds?.length || !segments.length) {
    return <div className="container-page py-12"><EmptyState icon={CalendarDays} title="No court selected" action={<Button to="/">Choose a court</Button>}>Pick a date, time and court first, then come back here to confirm.</EmptyState></div>
  }
  if (authLoading || facLoading || !settings) return <div className="container-page max-w-3xl py-10"><Skeleton className="h-96" /></div>
  if (!user) return <Navigate to="/auth" state={{ from: '/checkout' }} replace />

  const picked = courts.filter((c) => draft.courtIds.includes(c.id))
  const minutes = bookingMinutes({ segments })
  const slotCount = minutes / settings.slotMinutes
  const total = settings.pricePerSlot * slotCount * draft.courtIds.length

  // Already logged in: use what the account/profile already knows, ask only for what is missing.
  const needName = !validName(user.name)
  const needPhone = !validPhone(user.phone)
  const showName = needName || editing
  const showPhone = needPhone || editing
  const asking = showName || showPhone

  const submit = async (e) => {
    e.preventDefault()
    const name = showName ? form.name : user.name
    const phone = showPhone ? form.phone : user.phone
    const errs = {}
    if (!validName(name)) errs.name = 'Enter your full name.'
    if (!validPhone(phone)) errs.phone = 'Enter a valid mobile number (10–15 digits).'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true); setSubmitError('')
    try {
      // The database re-checks availability atomically — this is the authoritative check.
      const b = await api.createBooking({ courtIds: draft.courtIds, date: draft.date, segments, name: name.trim(), phone: cleanPhone(phone) })
      clearDraft()
      nav(`/pay/${b.id}`, { replace: true })
    } catch (err) {
      setSubmitError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <div className="container-page max-w-4xl py-8 sm:py-12">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Confirm your booking</h1>
      <p className="mt-1 text-muted">Review the details, then continue to pay online.</p>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1fr]">
        <form onSubmit={submit} noValidate className="card space-y-4 p-5 sm:p-6">
          <h2 className="text-lg font-bold">{asking ? 'Almost done' : 'Booking for'}</h2>

          {!asking ? (
            <div className="flex items-start gap-3 rounded-xl bg-paper p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-forest-900 text-volt-400"><UserRound className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{user.name}</p>
                <p className="text-muted">{cleanPhone(user.phone)}</p>
                <p className="break-all text-muted">{user.email}</p>
              </div>
              <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-forest-600 hover:bg-white"><Pencil className="size-4" aria-hidden />Edit</button>
            </div>
          ) : (
            <>
              <p className="-mt-2 text-sm text-muted">Booking as <strong className="break-all text-ink">{user.email}</strong>.{!editing && ' We only need the details missing from your account.'}</p>
              {showName && <Field label="Full name" error={errors.name}><input className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>}
              {showPhone && <Field label="Mobile number" error={errors.phone} hint="The owner may call this number about your booking."><input className="input" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>}
            </>
          )}

          {check.state === 'gone' && <Alert tone="error" title="Selection no longer available">{check.message} <Link to="/" className="font-semibold underline">Choose another</Link></Alert>}
          {check.state === 'error' && <Alert tone="warn">{check.message} We’ll still re-check when you submit.</Alert>}
          {submitError && <Alert tone="error">{submitError} <Link to="/" className="font-semibold underline">Back to courts</Link></Alert>}
          {errors.name && !showName && <Alert tone="error">Your account has no valid name. <button type="button" className="font-semibold underline" onClick={() => setEditing(true)}>Add it</button></Alert>}
          {errors.phone && !showPhone && <Alert tone="error">Your account has no valid mobile number. <button type="button" className="font-semibold underline" onClick={() => setEditing(true)}>Add it</button></Alert>}

          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={check.state === 'gone' || check.state === 'checking'}>
            {check.state === 'checking' ? 'Checking availability…' : `Continue to payment · ${money(total)}`}
          </Button>
          <p className="flex gap-2 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span>We’ll hold your court{picked.length > 1 ? 's' : ''} for {settings.holdMinutes} minutes while you pay. Your booking is <strong>not confirmed</strong> until the online payment is verified.</span></p>
        </form>

        <section className="card h-fit p-5 sm:p-6" aria-label="Booking summary">
          <h2 className="text-lg font-bold">Summary</h2>
          <div className="mt-3 rounded-xl bg-forest-900 p-4 text-white">
            <p className="font-display text-xl font-bold">{picked.map((c) => c.name).join(' + ')}</p>
            <p className="mt-2 flex items-center gap-2 text-sm text-white/80"><CalendarDays className="size-4 text-volt-400" aria-hidden />{fmtDateLong(draft.date)}</p>
            <div className="mt-1 flex items-start gap-2 text-sm text-white/80">
              <Clock className="mt-0.5 size-4 shrink-0 text-volt-400" aria-hidden />
              <ul>{segments.map((g) => <li key={g.start}>{fmtRange(g.start, g.end)}</li>)}</ul>
            </div>
          </div>
          <dl className="mt-3 divide-y divide-line">
            <DetailRow label="Facility">{settings.name}</DetailRow>
            <DetailRow label="Location"><span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{settings.address}</span></DetailRow>
            <DetailRow label="Duration">{fmtDuration(minutes)}</DetailRow>
            <DetailRow label="Price">{money(settings.pricePerSlot)} × {slotCount} slot{slotCount > 1 ? 's' : ''} × {picked.length} court{picked.length > 1 ? 's' : ''}</DetailRow>
            <DetailRow label="Total to pay"><span className="font-display text-lg font-extrabold">{money(total)}</span></DetailRow>
          </dl>
          {check.state === 'gone' && <p className="mt-3 flex items-center gap-2 text-sm text-red-700"><AlertTriangle className="size-4" aria-hidden />Your selection is no longer free.</p>}
        </section>
      </div>
    </div>
  )
}
