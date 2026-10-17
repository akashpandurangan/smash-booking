import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Banknote, CalendarDays, Check, Clock, MapPin, RefreshCw, ShieldCheck, CreditCard, Timer, Ban, Lock, Hourglass } from 'lucide-react'
import { useAuth, useFacility, useToast } from '../context/contexts.js'
import { api } from '../lib/api/index.js'
import { friendlyError } from '../lib/errors.js'
import { courtState } from '../lib/availability.js'
import { HERO_IMAGE_URL } from '../lib/config.js'
import { addDays, fmt12, fmtDate, fmtDateLong, fmtDuration, fmtRange, fmtRangeShort, fromMin, isClosedDay, mergeSlots, money, nowMinutes, toMin, todayISO } from '../lib/time.js'
import { Alert, Badge, Button, Skeleton } from '../components/ui.jsx'
import { CourtIllustration } from '../components/Bits.jsx'
import CalendarPopup from '../components/Calendar.jsx'
import { saveDraft } from '../lib/draft.js'

const STRIP_DAYS = 7
const UNIT = 60 // time slots are shown as 1-hour windows (pricing stays per 30-minute slot)

const COURT_STYLE = {
  available: { badge: <Badge tone="lime">Available</Badge>, cls: 'border-line bg-white hover:border-forest-600 hover:shadow-card' },
  pending: { badge: <Badge tone="amber"><Hourglass className="size-3" aria-hidden />Held</Badge>, cls: 'border-amber-200 bg-amber-50/60' },
  booked: { badge: <Badge tone="slate"><Lock className="size-3" aria-hidden />Booked</Badge>, cls: 'border-line bg-paper' },
  blocked: { badge: <Badge tone="slate"><Ban className="size-3" aria-hidden />Unavailable</Badge>, cls: 'hatch border-line bg-paper' },
  past: { badge: <Badge tone="slate">Passed</Badge>, cls: 'border-line bg-paper' },
  inactive: { badge: <Badge tone="slate">Closed</Badge>, cls: 'border-line bg-paper' },
}
const SEVERITY = ['blocked', 'booked', 'pending', 'past', 'inactive'] // which "not available" state to show first
const hoursLabel = (h) => `${h} Hour${h > 1 ? 's' : ''}`

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
  const [durChoice, setDurChoice] = useState(1) // hours (the owner decides which durations exist)
  const [start, setStart] = useState(null) // index of the first 1-hour window
  const [picked, setPicked] = useState(null) // null = automatic (first free court); array = user's choice
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [busy, setBusy] = useState([])
  const [busyLoading, setBusyLoading] = useState(true)
  const [busyError, setBusyError] = useState('')

  const today = settings ? todayISO(settings.timezone) : null
  // default = today, or the first open day if today is a weekly day off / holiday
  const firstOpen = settings ? Array.from({ length: settings.advanceBookingDays }, (_, k) => addDays(today, k)).find((d) => !isClosedDay(settings, d)) : null
  const effectiveDate = date || firstOpen || today
  const offered = (settings?.availableDurations?.length ? settings.availableDurations : [1, 2, 3, 4]).slice().sort((a, b) => a - b)
  const dur = offered.includes(durChoice) ? durChoice : offered[0]

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

  // 1-hour windows between opening and closing time.
  const windows = useMemo(() => {
    if (!settings) return []
    const out = []
    const open = toMin(settings.openingTime)
    const close = toMin(settings.closingTime)
    for (let t = open; t + UNIT <= close; t += UNIT) out.push({ start: fromMin(t), end: fromMin(t + UNIT) })
    return out
  }, [settings])
  const slotsPerWindow = settings ? UNIT / settings.slotMinutes : 2
  const maxHours = settings ? Math.floor((settings.maxSlotsPerBooking * settings.slotMinutes) / 60) : 1

  /** State of every court across a set of windows: a court is free only if it is free for ALL of them. */
  const statesFor = useCallback(
    (idxs) => courts.map((court) => {
      const results = idxs.map((i) => courtState({ court, busy, start: windows[i].start, end: windows[i].end, date: effectiveDate, settings }))
      const bad = results.filter((r) => r.state !== 'available').sort((a, b) => SEVERITY.indexOf(a.state) - SEVERITY.indexOf(b.state))[0]
      return { court, ...(bad || { state: 'available', mine: false }) }
    }),
    [courts, busy, windows, effectiveDate, settings],
  )

  // Each window: hidden when already past (today only); disabled only when NO court can take it.
  const options = useMemo(() => {
    if (!settings) return []
    const nowMin = effectiveDate === todayISO(settings.timezone) ? nowMinutes(settings.timezone) : -1
    return windows.map((w, i) => ({ i, ...w, free: statesFor([i]).filter((x) => x.state === 'available').length, hidden: toMin(w.start) <= nowMin }))
  }, [settings, windows, statesFor, effectiveDate])

  // ---- selection: start window + duration → the required consecutive windows, kept in sync automatically ----
  const needed = start == null ? [] : Array.from({ length: dur }, (_, k) => start + k)
  const inRange = needed.filter((i) => i < windows.length)
  const label = (i) => fmtRangeShort(windows[i].start, windows[i].end)
  const durLabel = hoursLabel(dur).toLowerCase()
  let problem = null
  let conflictIdx = []
  if (start != null && options.length) {
    if (inRange.length < dur) {
      problem = `${hoursLabel(dur)} from ${fmt12(windows[start].start)} would run past closing time (${fmt12(settings.closingTime)}). Pick an earlier start time or a shorter duration.`
    } else {
      conflictIdx = needed.filter((i) => options[i].free === 0 || options[i].hidden)
      if (conflictIdx.length) {
        problem = `${conflictIdx.map(label).join(' and ')} ${conflictIdx.length > 1 ? 'are' : 'is'} not available, so ${durLabel} from ${fmt12(windows[start].start)} can’t be booked. Pick another start time or a shorter duration.`
      } else if (!statesFor(needed).some((x) => x.state === 'available')) {
        problem = `No single court is free for the whole ${durLabel} starting at ${fmt12(windows[start].start)} (${label(needed[0])} to ${label(needed[needed.length - 1])}). Pick another start time or a shorter duration.`
      }
    }
  }
  const hasSel = start != null
  const valid = hasSel && !problem

  const states = hasSel
    ? statesFor(inRange)
    : courts.map((court) => ({ court, state: court.isActive ? 'available' : 'inactive', mine: false, neutral: true }))
  const availIds = states.filter((x) => x.state === 'available').map((x) => x.court.id) // already in court order
  // Courts to use: the user's choice (those still free), else the first free court (Court 1 → 2 → 3).
  let chosen = (picked || []).filter((id) => availIds.includes(id))
  if (!chosen.length && availIds.length) chosen = [availIds[0]]
  const dropped = (picked || []).length - (picked || []).filter((id) => availIds.includes(id)).length

  const segments = valid ? mergeSlots(inRange.map((i) => windows[i])) : []
  const baseSlots = dur * slotsPerWindow
  const minutes = dur * UNIT
  const total = valid && settings ? settings.pricePerSlot * baseSlots * chosen.length : 0
  const chosenNames = courts.filter((c) => chosen.includes(c.id)).map((c) => c.name.replace('Court ', ''))

  const pickDate = (d) => { setDate(d); setStart(null) }
  const pickDuration = (h) => setDurChoice(h)
  const pickStart = (i, el) => {
    setStart(start === i ? null : i)
    el?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
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
  const canConfirm = valid && chosen.length > 0

  return (
    <>
      {/* Hero */}
      <section className="on-dark relative overflow-hidden bg-forest-900 text-white">
        {HERO_IMAGE_URL && <img src={HERO_IMAGE_URL} alt="" className="absolute inset-0 size-full object-cover opacity-25" />}
        <div className="container-page relative grid items-center gap-8 pb-20 pt-8 sm:pt-14 lg:grid-cols-[1.4fr_1fr] lg:pb-28">
          <div className="rise">
            <h1 className="text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">{settings.tagline}</h1>
            <p className="mt-3 font-display text-xl font-bold text-volt-400 sm:text-2xl">{settings.name}</p>
            <p className="mt-4 max-w-lg text-base text-white/75 sm:text-lg">Pick your duration and time, choose your courts, and pay online. Your booking is confirmed as soon as the payment is verified.</p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
              <li className="flex items-center gap-2"><MapPin className="size-4 text-volt-400" aria-hidden />{[settings.address, settings.city].filter(Boolean).join(', ') || 'Address not set yet'}</li>
              <li className="flex items-center gap-2"><Clock className="size-4 text-volt-400" aria-hidden />{fmt12(settings.openingTime)} – {fmt12(settings.closingTime)} daily</li>
              <li className="flex items-center gap-2"><Banknote className="size-4 text-volt-400" aria-hidden />{money(settings.pricePerSlot * slotsPerWindow)} per court / hour</li>
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
                  const closed = isClosedDay(settings, d)
                  return (
                    <button key={d} role="radio" aria-checked={on} disabled={closed} onClick={() => pickDate(d)} title={closed ? 'Closed' : undefined}
                      className={`flex w-[3.75rem] disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-60 shrink-0 snap-start flex-col items-center justify-center rounded-2xl border py-2.5 transition-all sm:w-auto sm:min-w-[3.75rem] sm:flex-1 ${on ? 'border-forest-900 bg-forest-900 text-white shadow-card' : 'border-line bg-white hover:border-forest-600'}`}>
                      <span className={`text-xs ${on ? 'text-volt-400' : 'text-muted'}`}>{d === today ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                      <span className="font-display text-xl font-bold leading-tight">{dt.getDate()}</span>
                      <span className={`text-xs ${on ? 'text-white/70' : 'text-muted'}`}>{closed ? 'Closed' : dt.toLocaleDateString('en-IN', { month: 'short' })}</span>
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

          <Section step="2" title="Choose Your Duration">
            <div className="grid grid-cols-4 gap-2 sm:flex sm:gap-2.5" role="radiogroup" aria-label="Duration">
              {offered.map((h) => {
                const on = dur === h
                const unavailable = h > maxHours
                return (
                  <button key={h} role="radio" aria-checked={on} disabled={unavailable} onClick={() => pickDuration(h)}
                    title={unavailable ? 'Not allowed by the facility’s booking limit' : undefined}
                    className={`min-h-11 rounded-xl border px-1 text-sm sm:min-w-[6rem] sm:px-4 font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'border-forest-900 bg-forest-900 text-white shadow-card' : 'border-line bg-white hover:border-forest-600'}`}>
                    {hoursLabel(h)}
                  </button>
                )
              })}
            </div>
          </Section>

          <Section step="3" title="Choose Your Time Slot"
            right={<button onClick={() => loadBusy(effectiveDate)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted hover:bg-paper" aria-label="Refresh availability"><RefreshCw className={`size-4 ${busyLoading ? 'animate-spin' : ''}`} aria-hidden />Refresh</button>}>
            <p className="mb-3 text-sm text-muted">
              {dur > 1 ? `Pick your start time — the next ${dur - 1} hour${dur > 2 ? 's are' : ' is'} selected for you.` : 'Pick your start time.'}
              <span className="sm:hidden"> Swipe to see more.</span>
            </p>
            {busyError && <Alert tone="error" className="mb-4">{busyError}</Alert>}
            <Legend />
            {busyLoading && !busy.length ? (
              <div className="flex gap-2.5 overflow-hidden">{Array.from({ length: 6 }, (_, k) => <Skeleton key={k} className="h-14 w-36 shrink-0" />)}</div>
            ) : !visible.length ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No more time slots today. Pick another date above.</p>
            ) : (
              // phones: one swipeable row · tablet/desktop: wrapping grid (up to 6 per row)
              <div key={effectiveDate} className="-m-2 flex snap-x gap-2.5 overflow-x-auto p-2 pb-3 [overflow-anchor:none] no-scrollbar sm:m-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:p-0 lg:grid-cols-6" role="group" aria-label="Time slots">
                {visible.map((o) => {
                  const disabled = o.free === 0 // disabled ONLY when no court can take it
                  const on = needed.includes(o.i)
                  const conflict = on && conflictIdx.includes(o.i)
                  const isStart = start === o.i
                  return (
                    <button key={o.i} disabled={disabled} onClick={(e) => pickStart(o.i, e.currentTarget)} aria-pressed={on}
                      aria-label={`${fmtRange(o.start, o.end)}${isStart ? ', start' : on ? ', selected' : ''}${disabled ? ', not available' : ''}`}
                      className={`relative flex min-h-14 w-[8.25rem] shrink-0 snap-start flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition-all disabled:cursor-not-allowed sm:w-auto ${conflict ? 'border-red-400 bg-red-50 text-red-800' : on ? 'border-forest-900 bg-forest-900 text-white shadow-card' : disabled ? 'border-line bg-paper text-muted/70' : 'border-line bg-white hover:border-forest-600'}`}>
                      {on && !conflict && (
                        <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-volt-400 text-forest-950 ring-2 ring-white" aria-hidden>
                          <Check className="size-3.5" strokeWidth={3} />
                        </span>
                      )}
                      <span className={`whitespace-nowrap text-[13px] font-semibold leading-tight ${disabled ? 'line-through decoration-muted/40' : ''}`}>{fmtRangeShort(o.start, o.end)}</span>
                      {disabled && <span className="mt-0.5 text-[11px] font-semibold leading-none">Not available</span>}
                    </button>
                  )
                })}
              </div>
            )}
            {problem && (
              <Alert tone="error" className="mt-4" title="This selection isn’t available">{problem}</Alert>
            )}
          </Section>

          {/* Always visible. Court 1 → 2 → 3: the first free court is pre-selected; change it freely. */}
          <Section step="4" title="Pick your court">
            <p className="mb-3 text-sm text-muted">
              {valid
                ? `Free for the whole ${durLabel}. Select one or more courts.`
                : 'Court 1 is selected by default. Choose your time slot above to see which courts are free.'}
              <span className="sm:hidden"> Swipe to see all courts.</span>
            </p>
            {/* phones: swipeable row · tablet/desktop: 3-column grid */}
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-2 no-scrollbar sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:py-0" role="group" aria-label="Courts">
              {states.map(({ court, state, mine, neutral }) => {
                const st = COURT_STYLE[state]
                const can = state === 'available'
                const on = can && chosen.includes(court.id)
                return (
                  <button key={court.id} role="checkbox" aria-checked={on} disabled={!can} onClick={() => toggleCourt(court.id)}
                    className={`relative w-[72%] shrink-0 snap-center rounded-2xl border-2 p-4 text-left transition-all disabled:cursor-not-allowed sm:w-auto ${on ? 'border-forest-900 bg-forest-900 text-white shadow-lift' : st.cls}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-lg font-bold">{court.name}</span>
                      {on ? <span className="grid size-6 place-items-center rounded-full bg-volt-400 text-forest-950"><Check className="size-4" strokeWidth={3} aria-hidden /><span className="sr-only">Selected</span></span> : neutral ? null : st.badge}
                    </div>
                    <p className={`mt-2 text-sm ${on ? 'text-white/75' : 'text-muted'}`}>
                      {can ? (on ? 'Selected' : money(settings.pricePerSlot * baseSlots))
                        : state === 'pending' ? (mine ? 'Your unpaid hold' : 'Held while payment completes')
                        : state === 'booked' ? (mine ? 'Your confirmed booking' : 'Already booked')
                        : state === 'blocked' ? 'Maintenance / private use' : 'Not bookable'}
                    </p>
                  </button>
                )
              })}
            </div>
            {dropped > 0 && <Alert tone="warn" className="mt-4">{dropped === 1 ? 'A court you chose isn’t' : 'Some courts you chose aren’t'} free for the whole time, so {dropped === 1 ? 'it was' : 'they were'} removed.</Alert>}
          </Section>
        </div>
      </div>

      {/* How it works */}
      <section className="container-page mt-10">
        <h2 className="text-2xl font-extrabold sm:text-3xl">How it works</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            { icon: CalendarDays, t: 'Pick your time', d: 'Choose a date, how long you want to play and your start time, then your courts.' },
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

      {/* Sticky bottom bar: duration, From / To, total and the confirm button. Updates live. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgb(12_31_23/0.25)] backdrop-blur" role="region" aria-label="Booking summary">
        <div className="container-page flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-4 md:justify-start md:gap-8">
            <div className="min-w-0" aria-live="polite">
              {valid ? (
                <>
                  <p className="font-display text-lg font-extrabold leading-tight">{fmtDuration(minutes)}</p>
                  <p className="mt-0.5 text-sm"><span className="text-muted">From</span> <strong>{fmt12(segments[0].start)}</strong> <span className="ml-1 text-muted">To</span> <strong>{fmt12(segments[segments.length - 1].end)}</strong></p>
                </>
              ) : problem ? (
                <>
                  <p className="flex items-center gap-1.5 font-display text-lg font-extrabold leading-tight text-red-700"><AlertTriangle className="size-4 shrink-0" aria-hidden />Not available</p>
                  <p className="text-sm text-muted">Change the start time or duration</p>
                </>
              ) : (
                <>
                  <p className="font-display text-lg font-extrabold leading-tight">{fmtDuration(minutes)} · select a start time</p>
                  <p className="text-sm text-muted">Tap a time slot above</p>
                </>
              )}
            </div>
            <div className="shrink-0 text-right md:text-left">
              <p className="text-xs text-muted">{valid && chosen.length ? `Court${chosen.length > 1 ? 's' : ''} ${chosenNames.join(', ')}` : 'Total'}</p>
              <p className="font-display text-xl font-extrabold leading-tight">{money(total)}</p>
            </div>
          </div>
          <Button size="lg" className="w-full md:w-auto md:min-w-56" disabled={!canConfirm} onClick={confirm}>
            {!hasSel ? 'Select a time' : problem ? 'Selection unavailable' : <>Confirm Booking <ArrowRight className="size-4" aria-hidden /></>}
          </Button>
        </div>
      </div>

      <CalendarPopup open={calendarOpen} onClose={() => setCalendarOpen(false)} value={effectiveDate} min={today} max={maxDate} onPick={pickDate} isDisabled={(d) => isClosedDay(settings, d)} />
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
