import { useState } from 'react'
import { Save } from 'lucide-react'
import { useFacility, useToast } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { isDemo } from '../../lib/config.js'
import { friendlyError } from '../../lib/errors.js'
import { toMin } from '../../lib/time.js'
import { Alert, Button, Field } from '../../components/ui.jsx'

function Group({ title, children, note }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export default function SettingsPage() {
  const { settings, reload } = useFacility()
  const toast = useToast()
  const [f, setF] = useState(() => ({ ...settings }))
  const [errors, setErrors] = useState({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const num = (k) => (e) => setF({ ...f, [k]: e.target.value === '' ? '' : Number(e.target.value) })

  const submit = async (e) => {
    e.preventDefault()
    const v = {}
    if (!f.name.trim()) v.name = 'Required.'
    if (toMin(f.openingTime) >= toMin(f.closingTime)) v.closingTime = 'Closing time must be after opening time.'
    if (!(f.pricePerSlot >= 0) || f.pricePerSlot === '') v.pricePerSlot = 'Enter a price.'
    if (f.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contactEmail)) v.contactEmail = 'Enter a valid email.'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true); setErr('')
    try {
      await api.admin.updateSettings({
        ...f, name: f.name.trim(), pricePerSlot: Number(f.pricePerSlot), maxSlotsPerBooking: Number(f.maxSlotsPerBooking), maxUnpaidHolds: Number(f.maxUnpaidHolds),
        holdMinutes: Number(f.holdMinutes), advanceBookingDays: Number(f.advanceBookingDays),
      })
      await reload()
      toast('Settings saved')
    } catch (x) { setErr(friendlyError(x)) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Settings</h1><p className="text-muted">Everything customers see is configured here.</p></div>
      {err && <Alert tone="error">{err}</Alert>}

      <Group title="Facility">
        <Field label="Facility name" error={errors.name}><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Tagline"><input className="input" value={f.tagline} onChange={set('tagline')} /></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" value={f.address} onChange={set('address')} /></Field>
        <Field label="Contact phone"><input className="input" type="tel" value={f.contactPhone} onChange={set('contactPhone')} /></Field>
        <Field label="Contact email" error={errors.contactEmail}><input className="input" type="email" value={f.contactEmail} onChange={set('contactEmail')} /></Field>
        <Field label="Cancellation policy" className="sm:col-span-2"><textarea className="input min-h-20" value={f.cancellationPolicy} onChange={set('cancellationPolicy')} /></Field>
      </Group>

      <Group title="Hours & holds" note="Time slots are 30 minutes and are generated from the opening and closing times. Customers can book several consecutive slots.">
        <Field label="Opening time"><input className="input" type="time" step="1800" value={f.openingTime} onChange={set('openingTime')} /></Field>
        <Field label="Closing time" error={errors.closingTime}><input className="input" type="time" step="1800" value={f.closingTime} onChange={set('closingTime')} /></Field>
        <Field label="Max consecutive slots per booking" hint="Each slot is 30 minutes (4 = up to 2 hours)."><input className="input" type="number" min="1" max="24" value={f.maxSlotsPerBooking} onChange={num('maxSlotsPerBooking')} /></Field>
        <Field label="Bookable days (incl. today)" hint="Customers can book today plus the following days. Max 14."><input className="input" type="number" min="1" max="14" value={f.advanceBookingDays} onChange={num('advanceBookingDays')} /></Field>
        <Field label="Unpaid hold (minutes)" hint="Courts are released if payment isn’t completed in this time."><input className="input" type="number" min="5" max="1440" value={f.holdMinutes} onChange={num('holdMinutes')} /></Field>
        <Field label="Max unpaid holds per customer"><input className="input" type="number" min="1" max="10" value={f.maxUnpaidHolds} onChange={num('maxUnpaidHolds')} /></Field>
      </Group>

      <Group title="Pricing (₹)" note="The full amount is charged online: price × number of slots × number of courts.">
        <Field label="Price per court per 30-min slot" error={errors.pricePerSlot}><input className="input" type="number" min="0" step="1" value={f.pricePerSlot} onChange={num('pricePerSlot')} /></Field>
      </Group>

      <Group title="Online payment" note="Razorpay is used when its keys are configured (see README). Otherwise customers see a clearly-labelled demo payment.">
        <label className="flex items-start gap-3 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-5 accent-forest-900" checked={!!f.allowDemoPayments} onChange={(e) => setF({ ...f, allowDemoPayments: e.target.checked })} />
          <span><strong>Allow test (demo) payments</strong> when Razorpay isn’t configured. Customers can then confirm a booking <em>without paying</em>. Turn this OFF before taking real bookings.</span>
        </label>
        {isDemo && <Alert tone="info" className="sm:col-span-2">Demo mode: nothing here is saved permanently.</Alert>}
      </Group>

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto"><Save className="size-4" aria-hidden />Save settings</Button>
      </div>
    </form>
  )
}
