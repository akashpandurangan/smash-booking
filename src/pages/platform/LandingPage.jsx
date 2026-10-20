import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, CalendarCheck, CalendarDays, Clock, CreditCard, LocateFixed, MapPin, Search, SearchX, ShieldCheck, Smartphone, Store, Trophy, X } from 'lucide-react'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { addDays, fmt12, todayISO } from '../../lib/time.js'
import { Alert, Button, EmptyState, Skeleton } from '../../components/ui.jsx'
import { CourtIllustration } from '../../components/Bits.jsx'
import FacilityCard from '../../components/FacilityCard.jsx'

const TZ = 'Asia/Kolkata'
const TIMES = Array.from({ length: 16 }, (_, i) => `${String(6 + i).padStart(2, '0')}:00`) // 6 AM … 9 PM start times
const GEO_ERRORS = {
  1: 'Location permission was denied. You can still search by city or area.',
  2: 'We couldn’t work out your location. Try searching by city or area.',
  3: 'Finding your location took too long. Try again or search by city or area.',
}

export default function LandingPage() {
  const [params, setParams] = useSearchParams()
  const today = todayISO(TZ)
  const maxDate = addDays(today, 13)

  // The search lives in the URL (?q=&date=&time=&near=1) so results can be shared and the back button works.
  const applied = {
    q: params.get('q') || '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : today,
    time: /^\d{2}:00$/.test(params.get('time') || '') ? params.get('time') : '',
  }
  const [form, setForm] = useState(applied)
  const [coords, setCoords] = useState(null) // { lat, lng } only while the visitor has asked to use their location
  const [geo, setGeo] = useState({ busy: false, error: '' })
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const token = useRef(0)

  const run = useCallback(async (q, date, time, c) => {
    const mine = ++token.current // ignore answers that arrive after a newer search
    setLoading(true)
    setError('')
    try {
      const rows = await api.searchFacilities({ query: q, date, time: time || null, lat: c?.lat, lng: c?.lng })
      if (mine === token.current) setResults(rows)
    } catch (e) {
      if (mine === token.current) { setResults(null); setError(friendlyError(e)) }
    } finally {
      if (mine === token.current) setLoading(false)
    }
  }, [])

  const key = `${applied.q}|${applied.date}|${applied.time}|${coords?.lat}|${coords?.lng}`
  useEffect(() => { run(applied.q, applied.date, applied.time, coords) }, [key, run]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => {
    e.preventDefault()
    const next = {}
    if (form.q.trim()) next.q = form.q.trim()
    if (form.date && form.date !== today) next.date = form.date
    if (form.time) next.time = form.time
    setParams(next)
    document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeo({ busy: false, error: 'Your browser can’t share its location. Search by city or area instead.' }); return }
    setGeo({ busy: true, error: '' })
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeo({ busy: false, error: '' }) },
      (err) => setGeo({ busy: false, error: GEO_ERRORS[err.code] || GEO_ERRORS[2] }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }

  const withDistance = results?.filter((f) => f.distanceKm != null).length ?? 0
  const noLocation = coords && results ? results.length - withDistance : 0
  const searched = !!(applied.q || applied.time || coords)

  return (
    <>
      <section className="on-dark relative bg-forest-900 text-white">
        <div className="container-page grid items-center gap-8 pb-28 pt-10 sm:pt-16 lg:grid-cols-[1.5fr_1fr]">
          <div className="rise">
            <h1 className="text-[2.6rem] font-extrabold leading-[1.02] sm:text-6xl">Your next game <span className="text-volt-400">starts here.</span></h1>
            <p className="mt-4 max-w-xl text-base text-white/75 sm:text-lg">Discover badminton courts near you, see which times are actually free, and book in a few taps.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#results" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-volt-400 px-6 text-base font-semibold text-forest-950 hover:bg-volt-300">Find available courts <ArrowRight className="size-4" aria-hidden /></a>
              <Button to="/owner/register" size="lg" variant="outline" className="!border-white/25 !bg-transparent !text-white hover:!bg-white/10">List your facility</Button>
            </div>
          </div>
          <CourtIllustration className="mx-auto hidden h-64 rotate-90 opacity-95 lg:block" />
        </div>
      </section>

      <div className="container-page relative z-10 -mt-20">
        <form onSubmit={submit} className="card grid gap-3 p-4 sm:p-5 md:grid-cols-[1.6fr_1fr_1fr_auto] md:items-end" role="search" aria-label="Find courts">
          <div>
            <label htmlFor="q" className="mb-1 block text-sm font-semibold">City or area</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input id="q" className="input !pl-9" placeholder="e.g. Chennai, Baner, 411045" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} autoComplete="off" />
              </div>
              <button type="button" onClick={useMyLocation} disabled={geo.busy} aria-busy={geo.busy}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-paper disabled:opacity-60">
                <LocateFixed className={`size-4 ${geo.busy ? 'animate-pulse' : ''}`} aria-hidden /><span className="hidden sm:inline">{geo.busy ? 'Locating…' : 'Use my location'}</span><span className="sr-only sm:hidden">Use my location</span>
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="d" className="mb-1 block text-sm font-semibold">Date</label>
            <input id="d" type="date" className="input" min={today} max={maxDate} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div>
            <label htmlFor="t" className="mb-1 block text-sm font-semibold">Preferred time <span className="font-normal text-muted">(optional)</span></label>
            <select id="t" className="input" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}>
              <option value="">Any time</option>
              {TIMES.map((t) => <option key={t} value={t}>{fmt12(t)}</option>)}
            </select>
          </div>
          <Button type="submit" size="lg" className="md:min-h-11"><Search className="size-4" aria-hidden />Find available courts</Button>
        </form>
        {geo.error && <Alert tone="warn" className="mt-3">{geo.error}</Alert>}
        {coords && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <LocateFixed className="size-4 text-forest-600" aria-hidden />Sorted by distance from your current location (not stored).
            <button className="inline-flex items-center gap-1 font-semibold text-forest-600 hover:underline" onClick={() => setCoords(null)}><X className="size-3.5" aria-hidden />Clear</button>
          </p>
        )}
      </div>

      <section id="results" className="container-page scroll-mt-20 py-12" aria-labelledby="res-h" aria-busy={loading}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="res-h" className="text-2xl font-extrabold sm:text-3xl">{searched ? 'Courts matching your search' : 'Facilities on Smash Booking'}</h2>
            <p className="mt-1 text-sm text-muted" role="status">
              {loading ? 'Checking availability…' : results ? `${results.length} ${results.length === 1 ? 'facility' : 'facilities'}${applied.q ? ` for “${applied.q}”` : ''} · availability shown for ${new Date(`${applied.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}${applied.time ? ` at ${fmt12(applied.time)}` : ''}` : ''}
            </p>
          </div>
        </div>
        {noLocation > 0 && !loading && <p className="mt-2 text-sm text-muted">{noLocation} {noLocation === 1 ? 'facility has' : 'facilities have'} no map location yet, so distance isn’t shown for {noLocation === 1 ? 'it' : 'them'}.</p>}

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading && !results ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-80" />)
            : error ? <div className="sm:col-span-2 lg:col-span-3"><Alert tone="error" title="We couldn’t load facilities">{error} <button className="font-semibold underline" onClick={() => run(applied.q, applied.date, applied.time, coords)}>Try again</button></Alert></div>
            : results && !results.length ? (
              <div className="sm:col-span-2 lg:col-span-3">
                {searched ? (
                  <EmptyState icon={SearchX} title="No facilities match that search" action={<Button variant="dark" onClick={() => { setForm({ q: '', date: today, time: '' }); setCoords(null); setParams({}) }}>Clear search</Button>}>
                    Try a different city or area, or remove the time filter.
                  </EmptyState>
                ) : (
                  <EmptyState icon={Store} title="No facilities are live yet" action={<Button to="/owner/register">List your facility</Button>}>Facilities appear here as soon as an owner publishes one.</EmptyState>
                )}
              </div>
            ) : results?.map((f) => <FacilityCard key={f.slug} facility={f} date={applied.date} time={applied.time} />)}
        </div>
      </section>

      <section className="bg-paper py-14" aria-labelledby="how-h">
        <div className="container-page">
          <h2 id="how-h" className="text-2xl font-extrabold sm:text-3xl">How it works</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Search, t: 'Find a court near you', d: 'Search by city or area, or use your location, and compare prices and amenities.' },
              { icon: CalendarDays, t: 'Choose an available time', d: 'Pick a date and hour. You only see times that are genuinely free right now.' },
              { icon: Trophy, t: 'Book and play', d: 'Confirm your booking, pay if the facility takes online payments, and turn up ready to play.' },
            ].map(({ icon: Icon, t, d }, i) => (
              <li key={t} className="card p-5">
                <span className="grid size-10 place-items-center rounded-xl bg-forest-900 text-volt-400"><Icon className="size-5" aria-hidden /></span>
                <h3 className="mt-4 text-lg font-bold"><span className="text-volt-700">{i + 1}.</span> {t}</h3>
                <p className="mt-1 text-sm text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container-page py-14" aria-labelledby="players-h">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card p-6">
            <h2 id="players-h" className="text-xl font-extrabold">For players</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {[
                [Clock, 'Real availability — slots are checked against actual bookings, opening hours and maintenance blocks.'],
                [CalendarCheck, 'Book several hours or several courts in one go.'],
                [ShieldCheck, 'No double bookings — the database refuses a slot that is already taken.'],
                [Smartphone, 'Works on your phone; keep every booking in My Bookings.'],
              ].map(([Icon, text]) => <li key={text} className="flex items-start gap-3"><Icon className="mt-0.5 size-5 shrink-0 text-forest-600" aria-hidden />{text}</li>)}
            </ul>
          </div>
          <div className="on-dark card border-0 bg-forest-900 p-6 text-white">
            <h2 className="text-xl font-extrabold">For venue owners</h2>
            <ul className="mt-4 space-y-3 text-sm text-white/80">
              {[
                [Store, 'Your own booking page and a link you can share on WhatsApp or Instagram.'],
                [CreditCard, 'Connect your own Razorpay account — payments go straight to you and bookings confirm only after they are verified.'],
                [CalendarDays, 'A live calendar, manual bookings and maintenance blocks in one dashboard.'],
                [ShieldCheck, 'Your bookings and customers stay private to your facility.'],
              ].map(([Icon, text]) => <li key={text} className="flex items-start gap-3"><Icon className="mt-0.5 size-5 shrink-0 text-volt-400" aria-hidden />{text}</li>)}
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button to="/owner/register">List your facility <ArrowRight className="size-4" aria-hidden /></Button>
              <Link to="/owner/login" className="text-sm font-semibold text-white/80 hover:text-white hover:underline">Owner login</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
