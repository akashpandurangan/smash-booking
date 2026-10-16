import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Banknote, CalendarDays, Check, Clock, MapPin, RefreshCw, ShieldCheck, CreditCard, Timer, Ban, Lock, Hourglass } from 'lucide-react'
import { useAuth, useFacility, useToast } from '../context/contexts.js'
import { api } from '../lib/api/index.js'
import { friendlyError } from '../lib/errors.js'
import { courtState } from '../lib/availability.js'
import { HERO_IMAGE_URL } from '../lib/config.js'
import { addDays, fmt12, fmtDate, fmtDateLong, fmtDuration, fmtRange, fmtRangeShort, generateSlots, mergeSlots, money, nowMinutes, toMin, todayISO } from '../lib/time.js'
import { Alert, Badge, Button, Skeleton } from '../components/ui.jsx'
import { CourtIllustration } from '../components/Bits.jsx'
import CalendarPopup from '../components/Calendar.jsx'
import { saveDraft } from '../lib/draft.js'

const STRIP_DAYS = 7

const COURT_STYLE = {
  available: { badge: <Badge tone="lime">Available</Badge>, cls: 'border-line bg-white hover:border-forest-600 hover:shadow-card' },
  pending: { badge: <Badge tone="amber"><Hourglass className="size-3" aria-hidden />Held</Badge>, cls: 'border-amber-200 bg-amber-50/60' },
  booked: { badge: <Badge tone="slate"><Lock className="size-3" aria-hidden />Booked</Badge>, cls: 'border-line bg-paper' },
  blocked: { badge: <Badge tone="slate"><Ban className="size-3" aria-hidden />Unavailable</Badge>, cls: 'hatch border-line bg-paper' },
  past: { badge: <Badge tone="slate">Passed</Badge>, cls: 'border-line bg-paper' },
  inactive: { badge: <Badge tone="slate">Closed</Badge>, cls: 'border-line bg-paper' },
}
const SEVERITY = ['blocked', 'booked', 'pending', 'past', 'inactive'] // which "not available" state to show first

// Every section owns its padding, so spacing is identical above/below each one.
function Section({ step, title, right, children }) {
  return (
    <section className="px-4 py-5 sm:px-6 sm:py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg font-bold">
          <span className="grid size-6 place-items-center rounded-full bg-forest-900 text-xs font-bold text-volt-400">{step}</span>
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export default function BookPage() {
  const { settings, courts, loading: facLoading, error: facError, reload } = useFacility()
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [date, setDate] = useState(null) // null = today
  const [sel, setSel] = useState([]) // selected slot indexes, any mix (sorted), gaps allowed
  const [picked, setPicked] = useState(null) // null = automatic (first free court); array = user's choice
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [busy, setBusy] = useState([])
  const [busyLoading, setBusyLoading] = useState(true)
  const [busyError, setBusyError] = useState('')

  const today = settings ? todayISO(settings.timezone) : null
  const effectiveDate = date || today

  const loadBusy = useCallback(async (d, quiet) => {
    if (!d) return
    if (!quiet) setBusyLoading(true)
    setBusyError('')
    try {
      setBusy(await api.getBusy(d))
    } catch (e) {
      setBusyError(friendlyError(e))
    } finally {
      setBusyLoading(false)
    }
  }, [])

  // Availability is reloaded whenever the date changes (and every 30s while the page is open).
  useEffect(() => {
    loadBusy(effectiveDate)
    if (!effectiveDate) return undefined
    const t = setInterval(() => loadBusy(effectiveDate, true), 30000)
    return () => clearInterval(t)
  }, [effectiveDate, loadBusy])

  const slots = useMemo(() => (settings ? generateSlots(settings) : []), [settings])
  const maxSlots = settings?.maxSlotsPerBooking || 1

  /** State of every court across a set of slot indexes: a court is free only if it is free for ALL of them. */
  const statesFor = useCallback(
    (idxs) => courts.map((court) => {
      const results = idxs.map((i) => courtState({ court, busy, start: slots[i].start, end: slots[i].end, date: effectiveDate, settings }))
      const bad = results.filter((r) => r.state !== 'available').sort((a, b) => SEVERITY.indexOf(a.state) - SEVERITY.indexOf(b.state))[0]
      return { court, ...(bad || { state: 'available', mine: false }) }
    }),
    [courts, busy, slots, effectiveDate, settings],
  )

  // Every start time. Slots already in the past (today only) are hidden; a slot is
  // disabled only when NO court can take it.
  const options = useMemo(() => {
    if (!settings) return []
    const nowMin = effectiveDate === todayISO(settings.timezone) ? nowMinutes(settings.timezone) : -1
    return slots.map((s, i) => ({ i, start: s.start, end: s.end, free: statesFor([i]).filter((x) => x.state === 'available').length, hidden: toMin(s.start) <= nowMin }))
  }, [settings, slots, statesFor, effectiveDate])

  // ---- derived selection ----
  const hasSel = sel.length > 0
  const states = hasSel
    ? statesFor(sel)
    : courts.map((court) => ({ court, state: court.isActive ? 'available' : 'inactive', mine: false, neutral: true }))
  const availIds = states.filter((x) => x.state === 'available').map((x) => x.court.id) // already in court order
  // Courts to use: the user's choice (those still free), else the first free court (Court 1 → 2 → 3).
  let chosen = (picked || []).filter((id) => availIds.includes(id))
  if (!chosen.length && availIds.length) chosen = [availIds[0]]
  const dropped = (picked || []).length - (picked || []).filter((id) => availIds.includes(id)).length

  const slotObjs = sel.map((i) => slots[i])
  const segments = mergeSlots(slotObjs)
  const minutes = sel.length * (settings?.slotMinutes || 30)
  const total = settings ? settings.pricePerSlot * sel.length * chosen.length : 0
  const chosenNames = courts.filter((c) => chosen.includes(c.id)).map((c) => c.name.replace('Court ', ''))

  const pickDate = (d) => { setDate(d); setSel([]) }

  // Any slot can be added or removed independently — gaps are fine.
  const toggleSlot = (i) => {
    if (sel.includes(i)) { setSel(sel.filter((x) => x !== i)); return }
    if (sel.length >= maxSlots) { toast(`You can book up to ${maxSlots} slots (${fmtDuration(maxSlots * settings.slotMinutes)}) at a time.`, 'info'); return }
    const next = [...sel, i].sort((a, b) => a - b)
    if (!statesFor(next).some((x) => x.state === 'available')) {
      toast('No single court is free for all of those times together. Try a different combination.', 'info')
      return
    }
    setSel(next)
  }

  const toggleCourt = (id) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]
    if (!next.length) { toast('Keep at least one court selected.', 'info'); return }
    setPicked(next)
  }

  // Guests can browse and choose freely; login is only required at this point.
  const confirm = () => {
    saveDraft({ courtIds: chosen, date: effectiveDate, segments })
    navigate(user ? '/checkout' : '/auth', user ? undefined : { state: { from: '/checkout' } })
  }

  if (facError) {
    return (
      <div className="container-page py-16">
        <Alert tone="error" title="We couldn't load the facility">
          {facError}{' '}
          <button className="font-semibold underline" onClick={reload}>Try again</button>
        </Alert>
      </div>
    )
  }
  if (facLoading || !settings) {
    return (
      <div className="container-page space-y-4 py-10" aria-busy>
        <Skeleton className="h-56" /><Skeleton className="h-96" />
      </div>
    )
  }

  // Booking window: today + the next (advanceBookingDays - 1) days (14 days total by default).
  const maxDate = addDays(today, settings.advanceBookingDays - 1)
  const stripDays = Array.from({ length: Math.min(STRIP_DAYS, settings.advanceBookingDays) }, (_, k) => addDays(today, k))
  const farDate = !stripDays.includes(effectiveDate)
  const visible = options.filter((o) => !o.hidden)
  const groups = [
    { label: 'Morning', test: (m) => m < 720 },
    { label: 'Afternoon', test: (m) => m >= 720 && m < 1020 },
    { label: 'Evening', test: (m) => m >= 1020 },
  ]
  const canConfirm = hasSel && chosen.length > 0

  return (
    <>
      {/* Hero */}
      <section className="on-dark relative overflow-hidden bg-forest-900 text-white">
        {HERO_IMAGE_URL && <img src={HERO_IMAGE_URL} alt="" className="absolute inset-0 size-full object-cover opacity-25" />}
        <div className="container-page relative grid items-center gap-8 pb-20 pt-8 sm:pt-14 lg:grid-cols-[1.4fr_1fr] lg:pb-28">
          <div className="rise">
            <Badge tone="lime" className="!bg-volt-400/15 !text-volt-400 !ring-volt-400/30">3 courts · 30-minute slots</Badge>
            <h1 className="mt-4 text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">{settings.tagline}</h1>
            <p className="mt-4 max-w-lg text-base text-white/75 sm:text-lg">Pick your time slots, choose your courts, and pay online. Your booking is confirmed as soon as the payment is verified.</p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
              <li className="flex items-center gap-2"><MapPin className="size-4 text-volt-400" aria-hidden />{settings.address}</li>
              <li className="flex items-center gap-2"><Clock className="size-4 text-volt-400" aria-hidden />{fmt12(settings.openingTime)} – {fmt12(settings.closingTime)} daily</li>
              <li className="flex items-center gap-2"><Banknote className="size-4 text-volt-400" aria-hidden />{money(settings.pricePerSlot)} per court / {settings.slotMinutes} min</li>
            </ul>
          </div>
          <CourtIllustration className="mx-auto hidden h-72 rotate-90 opacity-95 lg:block" />
        </div>
      </section>

      {/* Booking widget — sections carry their own padding; dividers sit exactly between them */}
      <div className="container-page relative z-10 -mt-16">
        <div className="card min-w-0 divide-y divide-line">
          <Section step="1" title="Pick a date">
            {/* The 7 days scroll on small screens; the calendar button stays pinned at the end. */}
            <div className="flex items-stretch gap-2">
              <div className="-m-1 flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto p-1 no-scrollbar" role="radiogroup" aria-label="Date">
                {stripDays.map((d) => {
                  const on = d === effectiveDate
                  const dt = new Date(`${d}T00:00:00`)
                  return (
                    <button key={d} role="radio" aria-checked={on} onClick={() => pickDate(d)}
                      className={`flex w-[3.75rem] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border py-2.5 transition-all sm:w-auto sm:min-w-[3.75rem] sm:flex-1 ${on ? 'border-forest-900 bg-forest-900 text-white shadow-card' : 'border-line bg-white hover:border-forest-600'}`}>
                      <span className={`text-xs ${on ? 'text-volt-400' : 'text-muted'}`}>{d === today ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                      <span className="font-display text-xl font-bold leading-tight">{dt.getDate()}</span>
                      <span className={`text-xs ${on ? 'text-white/70' : 'text-muted'}`}>{dt.toLocaleDateString('en-IN', { month: 'short' })}</span>
                    </button>
                  )
                })}
              </div>
              <button onClick={() => setCalendarOpen(true)} aria-label={farDate ? `Selected ${fmtDateLong(effectiveDate)}. Open calendar` : 'Open calendar to pick another date'} aria-haspopup="dialog"
                className={`flex w-[3.75rem] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border py-2.5 transition-all ${farDate ? 'border-forest-900 bg-forest-900 text-white shadow-card' : 'border-line bg-white hover:border-forest-600'}`}>
                <CalendarDays className={`size-5 ${farDate ? 'text-volt-400' : ''}`} aria-hidden />
                <span className={`text-xs ${farDate ? 'text-white/80' : 'text-muted'}`}>{farDate ? fmtDate(effectiveDate, { day: 'numeric', month: 'short' }) : 'More'}</span>
              </button>
            </div>
            <p className="mt-3 text-sm text-muted">{fmtDateLong(effectiveDate)}</p>
          </Section>

          <Section step="2" title="Choose your time"
            right={<button onClick={() => loadBusy(effectiveDate)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted hover:bg-paper" aria-label="Refresh availability"><RefreshCw className={`size-4 ${busyLoading ? 'animate-spin' : ''}`} aria-hidden />Refresh</button>}>
            <p className="mb-4 text-sm text-muted">Tap any slots you want — they don’t have to be next to each other (up to {maxSlots} slots · {fmtDuration(maxSlots * settings.slotMinutes)}).</p>
            {busyError && <Alert tone="error" className="mb-4">{busyError}</Alert>}
            <Legend />
            {busyLoading && !busy.length ? (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 12 }, (_, k) => <Skeleton key={k} className="h-12" />)}</div>
            ) : !visible.length ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No more time slots today. Pick another date above.</p>
            ) : (
              groups.map((g) => {
                const items = visible.filter((o) => g.test(toMin(o.start)))
                if (!items.length) return null
                return (
                  <div key={g.label} className="mb-5 last:mb-0">
                    <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted">{g.label}</h3>
                    {/* up to 6 per row on wide screens; 4 on tablets; 3 on phones */}
                    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
                      {items.map((o) => {
                        const disabled = o.free === 0 // disabled ONLY when no court can take it
                        const on = sel.includes(o.i)
                        return (
                          <button key={o.i} disabled={disabled} onClick={() => toggleSlot(o.i)} aria-pressed={on}
                            aria-label={`${fmtRange(o.start, o.end)}${on ? ', selected' : ''}${disabled ? ', not available' : ''}`}
                            className={`relative flex min-h-12 flex-col items-center justify-center rounded-xl border px-1.5 py-2 text-center transition-all disabled:cursor-not-allowed ${on ? 'border-forest-900 bg-forest-900 text-white shadow-card' : disabled ? 'border-line bg-paper text-muted/70' : 'border-line bg-white hover:border-forest-600'}`}>
                            {on && (
                              <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-volt-400 text-forest-950 ring-2 ring-white" aria-hidden>
                                <Check className="size-3.5" strokeWidth={3} />
                              </span>
                            )}
                            <span className={`whitespace-nowrap text-[12.5px] font-semibold leading-tight ${disabled ? 'line-through decoration-muted/40' : ''}`}>{fmtRangeShort(o.start, o.end)}</span>
                            {disabled && <span className="mt-0.5 text-[11px] font-semibold leading-none text-muted">Not available</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </Section>

          {/* Always visible. Court 1 → 2 → 3: the first free court is pre-selected; change it freely. */}
          <Section step="3" title="Pick your court">
            <p className="mb-4 text-sm text-muted">
              {hasSel
                ? `Free for ${sel.length > 1 ? 'all your selected times' : fmtRange(slotObjs[0].start, slotObjs[0].end)}. Select one or more courts.`
                : 'Court 1 is selected by default. Choose your time above to see which courts are free.'}
            </p>
            <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Courts">
              {states.map(({ court, state, mine, neutral }) => {
                const st = COURT_STYLE[state]
                const can = state === 'available'
                const on = can && chosen.includes(court.id)
                return (
                  <button key={court.id} role="checkbox" aria-checked={on} disabled={!can} onClick={() => toggleCourt(court.id)}
                    className={`relative rounded-2xl border-2 p-4 text-left transition-all disabled:cursor-not-allowed ${on ? 'border-forest-900 bg-forest-900 text-white shadow-lift' : st.cls}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-lg font-bold">{court.name}</span>
                      {on ? <span className="grid size-6 place-items-center rounded-full bg-volt-400 text-forest-950"><Check className="size-4" strokeWidth={3} aria-hidden /><span className="sr-only">Selected</span></span> : neutral ? null : st.badge}
                    </div>
                    <p className={`mt-2 text-sm ${on ? 'text-white/75' : 'text-muted'}`}>
                      {can ? (on ? 'Selected' : money(settings.pricePerSlot * Math.max(sel.length, 1)))
                        : state === 'pending' ? (mine ? 'Your unpaid hold' : 'Held while payment completes')
                        : state === 'booked' ? (mine ? 'Your confirmed booking' : 'Already booked')
                        : state === 'blocked' ? 'Maintenance / private use' : 'Not bookable'}
                    </p>
                  </button>
                )
              })}
            </div>
            {dropped > 0 && <Alert tone="warn" className="mt-4">{dropped === 1 ? 'A court you chose isn’t' : 'Some courts you chose aren’t'} free for every selected time, so {dropped === 1 ? 'it was' : 'they were'} removed.</Alert>}
          </Section>
        </div>
      </div>

      {/* How it works */}
      <section className="container-page mt-10">
        <h2 className="text-2xl font-extrabold sm:text-3xl">How it works</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            { icon: CalendarDays, t: 'Pick your time', d: `Choose a date and any ${settings.slotMinutes}-minute slots you like, then your courts.` },
            { icon: CreditCard, t: 'Pay online', d: 'Log in with your email, then pay the total securely. Nothing is confirmed until the payment is verified.' },
            { icon: ShieldCheck, t: 'You’re booked', d: 'You get a booking reference straight away, and can find it any time in My Bookings.' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="card p-5">
              <span className="grid size-10 place-items-center rounded-xl bg-forest-900 text-volt-400"><Icon className="size-5" aria-hidden /></span>
              <h3 className="mt-4 text-lg font-bold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 flex items-start gap-2 text-sm text-muted"><Timer className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Courts are held for {settings.holdMinutes} minutes while you pay, then released automatically.</span></p>
      </section>
      <div className="h-36" aria-hidden /> {/* room for the sticky bar */}

      {/* Sticky bottom bar: duration, selected times, total and the confirm button. Updates live. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgb(12_31_23/0.25)] backdrop-blur" role="region" aria-label="Booking summary">
        <div className="container-page flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-4 md:justify-start md:gap-8">
            <div className="min-w-0" aria-live="polite">
              {hasSel ? (
                <>
                  <p className="font-display text-lg font-extrabold leading-tight">{fmtDuration(minutes)} <span className="text-sm font-semibold text-muted">· {sel.length} slot{sel.length > 1 ? 's' : ''}</span></p>
                  {segments.length === 1 ? (
                    <p className="mt-0.5 text-sm"><span className="text-muted">From</span> <strong>{fmt12(segments[0].start)}</strong> <span className="ml-1 text-muted">To</span> <strong>{fmt12(segments[0].end)}</strong></p>
                  ) : (
                    <p className="mt-0.5 truncate text-sm font-semibold" title={segments.map((g) => fmtRange(g.start, g.end)).join(', ')}>{segments.map((g) => fmtRangeShort(g.start, g.end)).join(' · ')}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-display text-lg font-extrabold leading-tight">Select your time</p>
                  <p className="text-sm text-muted">Tap one or more slots</p>
                </>
              )}
            </div>
            <div className="shrink-0 text-right md:text-left">
              <p className="text-xs text-muted">{chosen.length ? `Court${chosen.length > 1 ? 's' : ''} ${chosenNames.join(', ')}` : 'Total'}</p>
              <p className="font-display text-xl font-extrabold leading-tight">{money(total)}</p>
            </div>
          </div>
          <Button size="lg" className="w-full md:w-auto md:min-w-56" disabled={!canConfirm} onClick={confirm}>
            {!hasSel ? 'Select a time' : !chosen.length ? 'Choose a court' : <>Confirm Booking <ArrowRight className="size-4" aria-hidden /></>}
          </Button>
        </div>
      </div>

      <CalendarPopup open={calendarOpen} onClose={() => setCalendarOpen(false)} value={effectiveDate} min={today} max={maxDate} onPick={pickDate} />
    </>
  )
}

function Legend() {
  const items = [
    ['bg-white ring-1 ring-forest-600', 'Available'],
    ['bg-forest-900', 'Selected'],
    ['bg-slate-300 hatch', 'Not available'],
  ]
  return (
    <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-label="Legend">
      {items.map(([c, l]) => <li key={l} className="flex items-center gap-1.5"><span className={`size-3 rounded-sm ${c}`} aria-hidden />{l}</li>)}
    </ul>
  )
}
