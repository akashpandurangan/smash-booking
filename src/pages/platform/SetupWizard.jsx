import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, CreditCard, Globe, Loader2, MapPin, Plus, Rocket, Trash2, XCircle } from 'lucide-react'
import { useAuth } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { cleanSlugInput, isValidSlug, slugCandidates } from '../../lib/slug.js'
import { ROOT_DOMAIN, bookingUrl } from '../../lib/tenant.js'
import { WEEKDAYS, fmt12, fmtDate, money, toMin } from '../../lib/time.js'
import { Alert, Badge, Button, Field, Skeleton } from '../../components/ui.jsx'
import LinkActions, { LinkNote } from '../../components/LinkActions.jsx'
import { LOGO_URL } from '../../lib/config.js'

const STEPS = ['Facility', 'Web address', 'Courts', 'Hours & pricing', 'Payments', 'Review']
const MAX_COURTS = 6 // the database enforces the real per-plan limit
const DRAFT_KEY = 'owner-setup-draft-v1' // no secrets are ever stored here

const blank = () => ({
  name: '', tagline: 'Your Court. Your Game.', address: '', city: '', contactPhone: '', contactEmail: '', logoUrl: '',
  slug: '', slugTouched: false,
  courts: [{ name: 'Court 1', imageUrl: '' }, { name: 'Court 2', imageUrl: '' }],
  openingTime: '06:00', closingTime: '22:00', availableDurations: [1, 2, 3, 4], pricePerHour: 300,
  closedWeekdays: [], holidays: [], cancellationPolicy: 'Bookings can be cancelled up to 24 hours before the slot for a refund. Contact the facility for changes.',
  payMode: 'later', // 'razorpay' | 'test' | 'later'
})
const loadDraft = () => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    return d ? { form: { ...blank(), ...d.form }, step: Math.min(d.step || 0, STEPS.length - 1) } : null
  } catch { return null }
}

export default function SetupWizard() {
  const { user, loading: authLoading } = useAuth()
  const nav = useNavigate()
  const draft = useMemo(loadDraft, [])
  const [form, setForm] = useState(draft?.form || blank())
  const [step, setStep] = useState(draft?.step || 0)
  const [errors, setErrors] = useState({})
  const [rz, setRz] = useState({ keyId: '', keySecret: '', webhookSecret: '' }) // secrets live only in memory
  const [existing, setExisting] = useState(null)
  const [slugInfo, setSlugInfo] = useState({})
  const [slugChecking, setSlugChecking] = useState(false)
  const [submit, setSubmit] = useState({ state: 'idle', stage: '', error: '', result: null, warning: '' })
  const [holidayInput, setHolidayInput] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const patch = (o) => setForm((f) => ({ ...f, ...o }))

  // Owners who already have a facility go to their dashboard (unless we just created it).
  useEffect(() => {
    if (!user) return
    api.owner.myFacilities().then((l) => setExisting(l.length > 0)).catch(() => setExisting(false))
  }, [user])

  // keep a local draft (never secrets) so a refresh doesn't lose the owner's work
  useEffect(() => {
    if (submit.state === 'done') return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, step })) } catch { /* ignore */ }
  }, [form, step, submit.state])

  /* ---------- subdomain suggestions + live availability (the DB has the final say) ---------- */
  const candidates = useMemo(() => slugCandidates(form.name, form.city), [form.name, form.city])
  const candKey = candidates.join(',')
  useEffect(() => {
    const list = [...new Set([form.slug, ...candidates].filter(Boolean))].slice(0, 11)
    if (!list.length || !user) return undefined
    setSlugChecking(true)
    const t = setTimeout(async () => {
      try {
        const rows = await api.owner.checkSlugs(list)
        setSlugInfo((m) => ({ ...m, ...Object.fromEntries(rows.map((r) => [r.slug, r])) }))
      } catch { /* shown as "couldn't check" */ } finally { setSlugChecking(false) }
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.slug, candKey, user])

  // pre-select the best available suggestion until the owner types their own
  const autoPicked = useRef(false)
  useEffect(() => {
    if (form.slugTouched || form.slug || autoPicked.current) return
    const first = candidates.find((c) => slugInfo[c]?.available)
    if (first) { autoPicked.current = true; setForm((f) => ({ ...f, slug: first })) }
  }, [candidates, slugInfo, form.slug, form.slugTouched])

  if (authLoading) return <div className="container-page max-w-3xl py-10"><Skeleton className="h-96" /></div>
  if (!user) return <Navigate to="/owner/login" state={{ from: '/owner/setup' }} replace />
  if (existing && submit.state !== 'done') return <Navigate to="/owner" replace />

  const cur = slugInfo[form.slug]
  const slugOk = !!form.slug && isValidSlug(form.slug) && cur?.available === true
  const slugMsg = !form.slug ? null
    : !isValidSlug(form.slug) ? { tone: 'bad', text: 'Use 3–40 letters, numbers or single hyphens (not at the start or end).' }
    : !cur ? { tone: 'wait', text: 'Checking availability…' }
    : cur.available ? { tone: 'ok', text: 'Available — it’s yours once you finish setup.' }
    : { tone: 'bad', text: cur.reason === 'reserved' ? 'That name is reserved. Try another.' : 'That address is already taken. Pick one of the suggestions below.' }

  const validate = (i) => {
    const e = {}
    if (i === 0) {
      if (form.name.trim().length < 2) e.name = 'Enter your facility name.'
      if (form.address.trim().length < 3) e.address = 'Enter the street address.'
      if (form.city.trim().length < 2) e.city = 'Enter the city.'
      if (!/^\d{10,15}$/.test(form.contactPhone.replace(/\D/g, ''))) e.contactPhone = 'Enter a valid contact number (10–15 digits).'
      if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) e.contactEmail = 'Enter a valid email or leave it blank.'
      if (form.logoUrl && !/^https:\/\//.test(form.logoUrl.trim())) e.logoUrl = 'Logo must be an https:// image link.'
    }
    if (i === 1 && !slugOk) e.slug = slugMsg?.text || 'Choose a web address.'
    if (i === 2) {
      if (!form.courts.length) e.courts = 'Add at least one court.'
      else if (form.courts.some((c) => !c.name.trim())) e.courts = 'Every court needs a name.'
      else if (new Set(form.courts.map((c) => c.name.trim().toLowerCase())).size !== form.courts.length) e.courts = 'Court names must be different.'
      else if (form.courts.some((c) => c.imageUrl && !/^https:\/\//.test(c.imageUrl.trim()))) e.courts = 'Court images must be https:// links.'
    }
    if (i === 3) {
      if (!form.openingTime || !form.closingTime || toMin(form.openingTime) >= toMin(form.closingTime)) e.hours = 'Closing time must be after opening time.'
      else if (toMin(form.openingTime) % 30 || toMin(form.closingTime) % 30) e.hours = 'Use times on the hour or half hour.'
      if (!form.availableDurations.length) e.durations = 'Offer at least one duration.'
      if (!(Number(form.pricePerHour) >= 0) || form.pricePerHour === '') e.price = 'Enter a price (0 or more).'
    }
    if (i === 4 && form.payMode === 'razorpay') {
      if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(rz.keyId.trim())) e.keyId = 'Key ID looks like rzp_test_… or rzp_live_…'
      if (rz.keySecret.trim().length < 10) e.keySecret = 'Enter your Razorpay key secret.'
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  const go = (n) => { if (n > step && !validate(step)) return; setErrors({}); setStep(Math.max(0, Math.min(STEPS.length - 1, n))) }

  const activate = async () => {
    for (let i = 0; i < 5; i++) if (!validate(i)) { setStep(i); return }
    setSubmit({ state: 'working', stage: 'Reserving your web address…', error: '', result: null, warning: '' })
    try {
      const facility = await api.owner.createFacility({
        name: form.name.trim(), slug: form.slug, tagline: form.tagline.trim(), logoUrl: form.logoUrl.trim(), address: form.address.trim(), city: form.city.trim(),
        contactPhone: form.contactPhone.replace(/\D/g, ''), contactEmail: form.contactEmail.trim(), openingTime: form.openingTime, closingTime: form.closingTime,
        availableDurations: form.availableDurations, pricePerHour: Number(form.pricePerHour), courts: form.courts.map((c) => ({ name: c.name.trim(), imageUrl: c.imageUrl.trim() })),
        closedWeekdays: form.closedWeekdays, holidays: form.holidays, cancellationPolicy: form.cancellationPolicy.trim(),
      })
      let warning = ''
      setSubmit((s) => ({ ...s, stage: 'Configuring payments…' }))
      try {
        if (form.payMode === 'razorpay') await api.owner.savePaymentConfig(facility.id, { keyId: rz.keyId.trim(), keySecret: rz.keySecret.trim(), webhookSecret: rz.webhookSecret.trim() })
        else if (form.payMode === 'test') await api.owner.updateFacility(facility.id, { allowDemoPayments: true })
      } catch (e) {
        warning = `Your facility was created, but payments could not be configured: ${friendlyError(e)} You can fix this in Dashboard → Payments.`
      }
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      setRz({ keyId: '', keySecret: '', webhookSecret: '' }) // drop the secret from memory
      setSubmit({ state: 'done', stage: '', error: '', result: facility, warning })
    } catch (e) {
      setSubmit({ state: 'idle', stage: '', error: friendlyError(e), result: null, warning: '' })
      if (/slug/i.test(e.message)) setStep(1)
    }
  }

  /* ---------------- success ---------------- */
  if (submit.state === 'done') {
    const f = submit.result
    const live = f.status === 'active'
    return (
      <div className="container-page max-w-2xl py-10">
        <div className="card rise p-6 text-center sm:p-8">
          <span className={`mx-auto grid size-16 place-items-center rounded-2xl ${live ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{live ? <Rocket className="size-8" aria-hidden /> : <Clock className="size-8" aria-hidden />}</span>
          <h1 className="mt-4 text-3xl font-extrabold">{live ? 'Your booking page is live!' : 'Submitted for approval'}</h1>
          <p className="mt-2 text-muted">{live ? 'Players can now book courts at your facility.' : 'A platform administrator will review your facility. You can preview your page now; it goes public once approved.'}</p>
          <div className="mt-6 rounded-2xl bg-forest-900 p-5 text-left text-white">
            <p className="text-xs uppercase tracking-wider text-white/60">Your booking link</p>
            <p className="mt-1 break-all font-display text-xl font-bold text-volt-400">{bookingUrl(f.slug)}</p>
            <LinkNote slug={f.slug} className="mt-3 text-white/80" />
          </div>
          <LinkActions className="mt-4 justify-center" slug={f.slug} name={f.name} />
          {submit.warning && <Alert tone="warn" className="mt-4 text-left">{submit.warning}</Alert>}
          <Button size="lg" className="mt-6 w-full" onClick={() => nav('/owner', { replace: true })}>Go to my dashboard <ArrowRight className="size-4" aria-hidden /></Button>
        </div>
      </div>
    )
  }

  const err = (k) => errors[k]
  const toggleIn = (key, v) => patch({ [key]: form[key].includes(v) ? form[key].filter((x) => x !== v) : [...form[key], v].sort((a, b) => a - b) })

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Set up your facility</h1>
      <p className="mt-1 text-muted">Six quick steps and you’ll have your own booking website.</p>

      {/* progress */}
      <ol className="mt-6 flex items-center gap-1.5 overflow-x-auto pb-2 no-scrollbar" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex shrink-0 items-center gap-1.5" aria-current={i === step ? 'step' : undefined}>
            <button onClick={() => i < step && go(i)} disabled={i >= step} className={`flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-semibold ${i === step ? 'bg-forest-900 text-white' : i < step ? 'bg-volt-300/60 text-forest-900' : 'bg-white text-muted ring-1 ring-line'}`}>
              <span className={`grid size-6 place-items-center rounded-full text-xs ${i === step ? 'bg-volt-400 text-forest-950' : i < step ? 'bg-forest-900 text-volt-400' : 'bg-paper'}`}>{i < step ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}</span>
              <span className={i === step ? '' : 'hidden sm:inline'}>{s}</span>
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-line" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="card mt-4 p-5 sm:p-7">
        {submit.state === 'working' ? (
          <div className="py-10 text-center" role="status">
            <Loader2 className="mx-auto size-8 animate-spin text-forest-600" aria-hidden />
            <p className="mt-4 font-display text-xl font-bold">Setting up your booking page…</p>
            <p className="mt-1 text-sm text-muted">{submit.stage}</p>
          </div>
        ) : (
          <>
            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <h2 className="text-xl font-bold sm:col-span-2">About your facility</h2>
                <Field label="Facility name" error={err('name')} className="sm:col-span-2"><input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Smash Arena" autoFocus /></Field>
                <Field label="Tagline" className="sm:col-span-2"><input className="input" value={form.tagline} onChange={set('tagline')} /></Field>
                <Field label="Street address" error={err('address')} className="sm:col-span-2"><input className="input" value={form.address} onChange={set('address')} autoComplete="street-address" /></Field>
                <Field label="City" error={err('city')}><input className="input" value={form.city} onChange={set('city')} /></Field>
                <Field label="Contact phone" error={err('contactPhone')} hint="Shown to players."><input className="input" type="tel" inputMode="tel" value={form.contactPhone} onChange={set('contactPhone')} /></Field>
                <Field label="Contact email (optional)" error={err('contactEmail')}><input className="input" type="email" value={form.contactEmail} onChange={set('contactEmail')} /></Field>
                <Field label="Logo image link (optional)" error={err('logoUrl')} hint="An https link to your logo. Skip it to use the Smash Booking mark."><input className="input" value={form.logoUrl} onChange={set('logoUrl')} placeholder="https://…" /></Field>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div><h2 className="text-xl font-bold">Your booking website address</h2>
                  <p className="mt-1 text-sm text-muted">Players will book at this address. We turn your facility name into a clean web address — you can edit it.</p></div>
                <Field label="Web address" error={err('slug')}>
                  <div className="flex items-stretch overflow-hidden rounded-xl border border-line focus-within:border-forest-600 focus-within:ring-2 focus-within:ring-forest-600/20">
                    <input aria-label="Web address" className="min-w-0 flex-1 bg-white px-3.5 py-3 text-base outline-none" value={form.slug} onChange={(e) => { setErrors((x) => ({ ...x, slug: undefined })); patch({ slug: cleanSlugInput(e.target.value), slugTouched: true }) }} autoCapitalize="none" spellCheck={false} aria-describedby="slug-status" />
                    <span className="flex items-center bg-paper px-3 text-sm text-muted">.{ROOT_DOMAIN}</span>
                  </div>
                </Field>
                <p id="slug-status" aria-live="polite" className={`-mt-2 flex items-center gap-1.5 text-sm ${slugMsg?.tone === 'ok' ? 'text-emerald-700' : slugMsg?.tone === 'bad' ? 'text-red-700' : 'text-muted'}`}>
                  {slugMsg?.tone === 'ok' && <CheckCircle2 className="size-4" aria-hidden />}{slugMsg?.tone === 'bad' && <XCircle className="size-4" aria-hidden />}{(slugMsg?.tone === 'wait' || slugChecking) && !slugMsg?.tone && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {slugMsg?.text || 'Type a name or pick a suggestion.'}
                </p>
                {!!candidates.length && (
                  <div>
                    <p className="mb-2 text-sm font-semibold">Suggestions</p>
                    <div className="flex flex-wrap gap-2">
                      {candidates.map((c) => {
                        const info = slugInfo[c]
                        const taken = info && !info.available
                        return (
                          <button key={c} type="button" disabled={taken} onClick={() => { setErrors((x) => ({ ...x, slug: undefined })); patch({ slug: c, slugTouched: true }) }} aria-pressed={form.slug === c}
                            className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed ${form.slug === c ? 'border-forest-900 bg-forest-900 text-white' : taken ? 'border-line bg-paper text-muted line-through' : 'border-line bg-white hover:border-forest-600'}`}>
                            {c}.{ROOT_DOMAIN}
                            {taken ? <span className="text-xs no-underline">taken</span> : info?.available ? <span className="size-2 rounded-full bg-emerald-500" aria-label="available" /> : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                <Alert tone="info" title="How your link works">
                  Your branded address is <strong>{form.slug || 'yourname'}.{ROOT_DOMAIN}</strong> once the domain is connected by the platform. Until then your booking page lives at <strong className="break-all">/book/{form.slug || 'yourname'}</strong> on this site — you’ll get the full shareable link when setup finishes.
                  The address is reserved for you and can only be changed by a platform administrator.
                </Alert>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div><h2 className="text-xl font-bold">Your courts</h2><p className="mt-1 text-sm text-muted">Name each court the way your players know it. Up to {MAX_COURTS} courts on your plan.</p></div>
                {err('courts') && <Alert tone="error">{err('courts')}</Alert>}
                <ul className="space-y-3">
                  {form.courts.map((c, i) => (
                    <li key={i} className="rounded-2xl border border-line p-3 sm:p-4">
                      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
                        <Field label={`Court ${i + 1} name`}><input className="input" value={c.name} onChange={(e) => patch({ courts: form.courts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></Field>
                        <Field label="Image link (optional)"><input className="input" value={c.imageUrl} placeholder="https://…" onChange={(e) => patch({ courts: form.courts.map((x, j) => (j === i ? { ...x, imageUrl: e.target.value } : x)) })} /></Field>
                        <Button variant="dangerOutline" size="sm" onClick={() => patch({ courts: form.courts.filter((_, j) => j !== i) })} disabled={form.courts.length === 1} aria-label={`Remove court ${i + 1}`}><Trash2 className="size-4" aria-hidden />Remove</Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" onClick={() => patch({ courts: [...form.courts, { name: `Court ${form.courts.length + 1}`, imageUrl: '' }] })} disabled={form.courts.length >= MAX_COURTS}><Plus className="size-4" aria-hidden />Add a court</Button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-xl font-bold">Hours, durations & pricing</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Opening time"><input className="input" type="time" step="1800" value={form.openingTime} onChange={set('openingTime')} /></Field>
                  <Field label="Closing time" error={err('hours')}><input className="input" type="time" step="1800" value={form.closingTime} onChange={set('closingTime')} /></Field>
                </div>
                <fieldset>
                  <legend className="label">Booking durations you offer</legend>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4].map((h) => {
                      const on = form.availableDurations.includes(h)
                      return <button key={h} type="button" aria-pressed={on} onClick={() => toggleIn('availableDurations', h)} className={`min-h-11 min-w-[5.5rem] rounded-xl border px-4 text-sm font-semibold ${on ? 'border-forest-900 bg-forest-900 text-white' : 'border-line bg-white hover:border-forest-600'}`}>{h} Hour{h > 1 ? 's' : ''}</button>
                    })}
                  </div>
                  {err('durations') && <p className="mt-1.5 text-sm text-red-700">{err('durations')}</p>}
                </fieldset>
                <Field label="Price per court per hour (₹)" error={err('price')} hint={`A 2-hour booking of 2 courts costs ${money(Number(form.pricePerHour || 0) * 4)}.`}><input className="input sm:max-w-48" type="number" min="0" step="10" value={form.pricePerHour} onChange={set('pricePerHour')} /></Field>
                <fieldset>
                  <legend className="label">Weekly days off</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((d, i) => {
                      const on = form.closedWeekdays.includes(i)
                      return <button key={d} type="button" aria-pressed={on} onClick={() => toggleIn('closedWeekdays', i)} className={`min-h-10 rounded-xl border px-3 text-sm font-semibold ${on ? 'border-red-300 bg-red-50 text-red-800' : 'border-line bg-white hover:border-forest-600'}`}>{d.slice(0, 3)}{on && ' · closed'}</button>
                    })}
                  </div>
                </fieldset>
                <div>
                  <p className="label">Holidays (specific dates you are closed)</p>
                  <div className="flex gap-2">
                    <input className="input sm:max-w-56" type="date" value={holidayInput} onChange={(e) => setHolidayInput(e.target.value)} aria-label="Holiday date" />
                    <Button variant="outline" onClick={() => { if (holidayInput && !form.holidays.includes(holidayInput)) patch({ holidays: [...form.holidays, holidayInput].sort() }); setHolidayInput('') }} disabled={!holidayInput}><Plus className="size-4" aria-hidden />Add</Button>
                  </div>
                  {!!form.holidays.length && <ul className="mt-2 flex flex-wrap gap-2">{form.holidays.map((h) => <li key={h}><button type="button" onClick={() => patch({ holidays: form.holidays.filter((x) => x !== h) })} className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-sm ring-1 ring-line hover:bg-red-50" aria-label={`Remove ${h}`}>{fmtDate(h)}<Trash2 className="size-3.5 text-red-600" aria-hidden /></button></li>)}</ul>}
                </div>
                <Field label="Cancellation rules" hint="Shown to players on their booking."><textarea className="input min-h-24" value={form.cancellationPolicy} onChange={set('cancellationPolicy')} /></Field>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div><h2 className="text-xl font-bold">How will you get paid?</h2><p className="mt-1 text-sm text-muted">Players pay online and the money goes straight to <strong>your</strong> Razorpay account. A booking is only confirmed after the payment is verified on our server.</p></div>
                {[
                  ['razorpay', 'Connect my Razorpay account now', 'Recommended. Needs a Razorpay account (use TEST keys first).'],
                  ['test', 'Use test payments for now', 'Bookings confirm without charging anyone — good for trying things out. Turn off before going live.'],
                  ['later', 'I’ll set up payments later', 'Players can reserve a slot but can’t pay until you connect Razorpay in Dashboard → Payments.'],
                ].map(([v, t, d]) => (
                  <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-4 ${form.payMode === v ? 'border-forest-900 bg-paper' : 'border-line'}`}>
                    <input type="radio" name="payMode" className="mt-1 size-4 accent-forest-900" checked={form.payMode === v} onChange={() => patch({ payMode: v })} />
                    <span><span className="block font-semibold">{t}</span><span className="text-sm text-muted">{d}</span></span>
                  </label>
                ))}
                {form.payMode === 'razorpay' && (
                  <div className="grid gap-4 rounded-2xl bg-paper p-4 sm:grid-cols-2">
                    <Field label="Razorpay Key ID" error={err('keyId')}><input className="input" value={rz.keyId} onChange={(e) => setRz({ ...rz, keyId: e.target.value })} placeholder="rzp_test_…" autoComplete="off" spellCheck={false} /></Field>
                    <Field label="Razorpay Key Secret" error={err('keySecret')} hint="Sent securely to our server and never shown again."><input className="input" type="password" value={rz.keySecret} onChange={(e) => setRz({ ...rz, keySecret: e.target.value })} autoComplete="new-password" /></Field>
                    <Field label="Webhook secret (optional)" className="sm:col-span-2" hint="Lets bookings confirm even if a player closes the tab right after paying. Add the webhook later from Dashboard → Payments."><input className="input" type="password" value={rz.webhookSecret} onChange={(e) => setRz({ ...rz, webhookSecret: e.target.value })} autoComplete="new-password" /></Field>
                  </div>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-5">
                <h2 className="text-xl font-bold">Review & activate</h2>
                {submit.error && <Alert tone="error">{submit.error}</Alert>}
                <div className="overflow-hidden rounded-2xl border border-line">
                  <div className="on-dark flex items-center gap-3 bg-forest-900 p-4 text-white">
                    <img src={form.logoUrl.trim().startsWith('https://') ? form.logoUrl.trim() : LOGO_URL} alt="" className="size-12 rounded-xl bg-white object-cover" />
                    <div className="min-w-0"><p className="truncate font-display text-xl font-bold">{form.name || 'Your facility'}</p><p className="truncate text-sm text-volt-400">{form.slug}.{ROOT_DOMAIN}</p></div>
                    <Badge tone="lime" className="ml-auto">Preview</Badge>
                  </div>
                  <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
                    <div className="flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><div><dt className="sr-only">Address</dt><dd>{form.address}, {form.city}</dd></div></div>
                    <div className="flex gap-2"><Clock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><div><dt className="sr-only">Hours</dt><dd>{fmt12(form.openingTime)} – {fmt12(form.closingTime)}{form.closedWeekdays.length ? ` · closed ${form.closedWeekdays.map((d) => WEEKDAYS[d].slice(0, 3)).join(', ')}` : ''}</dd></div></div>
                    <div className="flex gap-2"><Globe className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><div><dt className="sr-only">Courts</dt><dd>{form.courts.length} court{form.courts.length > 1 ? 's' : ''}: {form.courts.map((c) => c.name).join(', ')}</dd></div></div>
                    <div className="flex gap-2"><CreditCard className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /><div><dt className="sr-only">Pricing</dt><dd>{money(form.pricePerHour)}/court/hour · {form.availableDurations.join(', ')} hr bookings · {{ razorpay: 'Razorpay', test: 'test payments', later: 'payments later' }[form.payMode]}</dd></div></div>
                  </dl>
                </div>
                <p className="text-sm text-muted">Clicking <strong>Activate</strong> reserves <strong>{form.slug}.{ROOT_DOMAIN}</strong> for you and creates your booking page.</p>
              </div>
            )}

            <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
              <Button variant="outline" onClick={() => go(step - 1)} disabled={step === 0}><ArrowLeft className="size-4" aria-hidden />Back</Button>
              {step < STEPS.length - 1
                ? <Button onClick={() => go(step + 1)}>Continue <ArrowRight className="size-4" aria-hidden /></Button>
                : <Button size="lg" onClick={activate}><Rocket className="size-4" aria-hidden />Activate booking page</Button>}
            </div>
          </>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-muted">Your progress is saved on this device. <Link to="/" className="underline">Cancel</Link></p>
    </div>
  )
}
