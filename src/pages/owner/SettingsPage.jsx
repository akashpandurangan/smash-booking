import { useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useFacility, useToast } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { isDemo } from '../../lib/config.js'
import { friendlyError } from '../../lib/errors.js'
import { WEEKDAYS, fmtDate, toMin } from '../../lib/time.js'
import { Alert, Button, Field } from '../../components/ui.jsx'
import ImagePicker from '../../components/ImagePicker.jsx'
import ProfileFields from '../../components/ProfileFields.jsx'
import { profileFrom, profilePayload, validateProfile } from '../../lib/profile.js'
import { useAdmin } from './OwnerLayout.jsx'

function Group({ title, children, note }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

/** Facility profile, hours, durations, pricing, holidays and cancellation rules. */
export default function SettingsPage() {
  const { settings } = useFacility()
  const { reloadFacility } = useAdmin()
  const toast = useToast()
  const [f, setF] = useState(() => ({ ...settings, pricePerHour: settings.pricePerSlot * (60 / settings.slotMinutes) }))
  const [p, setP] = useState(() => profileFrom(settings)) // about / location / amenities / cover
  const [errors, setErrors] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [holiday, setHoliday] = useState('')

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const num = (k) => (e) => setF({ ...f, [k]: e.target.value === '' ? '' : Number(e.target.value) })
  const toggle = (key, v) => setF({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v].sort((a, b) => (a > b ? 1 : -1)) })

  const submit = async (e) => {
    e.preventDefault()
    const v = {}
    if (f.name.trim().length < 2) v.name = 'Required.'
    if (f.address.trim().length < 3) v.address = 'Required.'
    if (f.city.trim().length < 2) v.city = 'Required.'
    if (f.contactPhone && !/^\d{10,15}$/.test(String(f.contactPhone).replace(/\D/g, ''))) v.contactPhone = 'Enter a valid number.'
    if (f.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contactEmail)) v.contactEmail = 'Enter a valid email.'
    if (f.logoUrl && !/^https:\/\//.test(f.logoUrl.trim())) v.logoUrl = 'Must be an https:// image link.'
    if (toMin(f.openingTime) >= toMin(f.closingTime)) v.closingTime = 'Closing time must be after opening time.'
    if (!f.availableDurations.length) v.durations = 'Offer at least one duration.'
    if (f.pricePerHour === '' || !(Number(f.pricePerHour) >= 0)) v.pricePerHour = 'Enter a price.'
    Object.assign(v, validateProfile(p))
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true); setErr('')
    try {
      await api.owner.updateFacility(settings.id, {
        name: f.name.trim(), tagline: f.tagline, logoUrl: f.logoUrl.trim(), address: f.address.trim(), city: f.city.trim(),
        contactPhone: String(f.contactPhone || '').replace(/\D/g, ''), contactEmail: f.contactEmail.trim(),
        openingTime: f.openingTime, closingTime: f.closingTime, availableDurations: f.availableDurations, pricePerHour: Number(f.pricePerHour),
        maxUnpaidHolds: Number(f.maxUnpaidHolds), holdMinutes: Number(f.holdMinutes), advanceBookingDays: Number(f.advanceBookingDays),
        cancellationPolicy: f.cancellationPolicy, closedWeekdays: f.closedWeekdays, holidays: f.holidays,
        ...profilePayload(p),
      })
      await reloadFacility()
      toast('Settings saved')
    } catch (x) { setErr(friendlyError(x)) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Settings</h1><p className="text-muted">Everything players see on your booking page.</p></div>
      {err && <Alert tone="error">{err}</Alert>}

      <Group title="Facility profile & branding">
        <Field label="Facility name" error={errors.name}><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Tagline"><input className="input" value={f.tagline} onChange={set('tagline')} /></Field>
        <Field label="Address" error={errors.address} className="sm:col-span-2"><input className="input" value={f.address} onChange={set('address')} /></Field>
        <Field label="City" error={errors.city}><input className="input" value={f.city} onChange={set('city')} /></Field>
        <Field label="Contact phone" error={errors.contactPhone}><input className="input" type="tel" value={f.contactPhone} onChange={set('contactPhone')} /></Field>
        <Field label="Contact email" error={errors.contactEmail}><input className="input" type="email" value={f.contactEmail} onChange={set('contactEmail')} /></Field>
        <Field label="Logo image link" error={errors.logoUrl} hint="An https link to your logo (shown in the header)."><input className="input" value={f.logoUrl} onChange={set('logoUrl')} placeholder="https://…" /></Field>
      </Group>

      <Group title="About, location & photo" note="Shown on your booking page and in search results. Only facilities that are published appear in search.">
        <div className="sm:col-span-2">
          <ImagePicker label="Cover photo" value={p.coverImageUrl} upload={(file) => api.owner.uploadImage(settings.id, file, 'cover')}
            onUploaded={(url) => setP((x) => ({ ...x, coverImageUrl: url }))} onRemove={() => setP((x) => ({ ...x, coverImageUrl: '' }))}
            hint="Shown on your facility card and page. Use a real photo of your courts — the card shows “Photo not added yet” until you add one." />
        </div>
        <ProfileFields value={p} onChange={(patch) => setP((x) => ({ ...x, ...patch }))} errors={errors} />
      </Group>

      <Group title="Opening hours & durations" note="Players pick a whole-hour start time from these hours.">
        <Field label="Opening time"><input className="input" type="time" step="1800" value={f.openingTime} onChange={set('openingTime')} /></Field>
        <Field label="Closing time" error={errors.closingTime}><input className="input" type="time" step="1800" value={f.closingTime} onChange={set('closingTime')} /></Field>
        <fieldset className="sm:col-span-2">
          <legend className="label">Durations you offer</legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((h) => {
              const on = f.availableDurations.includes(h)
              return <button key={h} type="button" aria-pressed={on} onClick={() => toggle('availableDurations', h)} className={`min-h-11 min-w-[5.5rem] rounded-xl border px-4 text-sm font-semibold ${on ? 'border-forest-900 bg-forest-900 text-white' : 'border-line bg-white hover:border-forest-600'}`}>{h} Hour{h > 1 ? 's' : ''}</button>
            })}
          </div>
          {errors.durations && <p className="mt-1.5 text-sm text-red-700">{errors.durations}</p>}
        </fieldset>
        <Field label="Bookable days ahead (incl. today)" hint="Max 14."><input className="input" type="number" min="1" max="14" value={f.advanceBookingDays} onChange={num('advanceBookingDays')} /></Field>
        <Field label="Unpaid hold (minutes)" hint="Courts are released if payment isn’t completed in this time."><input className="input" type="number" min="5" max="1440" value={f.holdMinutes} onChange={num('holdMinutes')} /></Field>
        <Field label="Max unpaid holds per player"><input className="input" type="number" min="1" max="10" value={f.maxUnpaidHolds} onChange={num('maxUnpaidHolds')} /></Field>
      </Group>

      <Group title="Days closed" note="Players can’t book on weekly days off or holidays.">
        <fieldset className="sm:col-span-2">
          <legend className="label">Weekly days off</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d, i) => {
              const on = f.closedWeekdays.includes(i)
              return <button key={d} type="button" aria-pressed={on} onClick={() => toggle('closedWeekdays', i)} className={`min-h-10 rounded-xl border px-3 text-sm font-semibold ${on ? 'border-red-300 bg-red-50 text-red-800' : 'border-line bg-white hover:border-forest-600'}`}>{d.slice(0, 3)}{on && ' · closed'}</button>
            })}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <p className="label">Holidays</p>
          <div className="flex gap-2">
            <input className="input sm:max-w-56" type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} aria-label="Holiday date" />
            <Button variant="outline" onClick={() => { if (holiday && !f.holidays.includes(holiday)) setF({ ...f, holidays: [...f.holidays, holiday].sort() }); setHoliday('') }} disabled={!holiday}><Plus className="size-4" aria-hidden />Add</Button>
          </div>
          {!!f.holidays.length && <ul className="mt-2 flex flex-wrap gap-2">{f.holidays.map((h) => <li key={h}><button type="button" onClick={() => setF({ ...f, holidays: f.holidays.filter((x) => x !== h) })} className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-sm ring-1 ring-line hover:bg-red-50" aria-label={`Remove ${h}`}>{fmtDate(h)}<Trash2 className="size-3.5 text-red-600" aria-hidden /></button></li>)}</ul>}
        </div>
      </Group>

      <Group title="Pricing (₹)" note="The full amount is charged online: price × hours × number of courts.">
        <Field label="Price per court per hour" error={errors.pricePerHour}><input className="input" type="number" min="0" step="10" value={f.pricePerHour} onChange={num('pricePerHour')} /></Field>
      </Group>

      <Group title="Cancellation rules">
        <Field label="Shown to players on their booking" className="sm:col-span-2"><textarea className="input min-h-24" value={f.cancellationPolicy} onChange={set('cancellationPolicy')} /></Field>
        {isDemo && <Alert tone="info" className="sm:col-span-2">Demo mode: changes are kept only in this browser (not on a server).</Alert>}
      </Group>

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto"><Save className="size-4" aria-hidden />Save settings</Button>
      </div>
    </form>
  )
}
