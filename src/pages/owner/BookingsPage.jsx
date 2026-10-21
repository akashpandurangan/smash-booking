import { useMemo, useState } from 'react'
import { Plus, SearchX } from 'lucide-react'
import { useFacility, useToast } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { PAYMENT_STATUS, STATUS } from '../../lib/status.js'
import { addDays, fmt12, fmtDate, fmtDuration, fromMin, generateSlots, money, toMin, todayISO, fmtSegments } from '../../lib/time.js'
import { Alert, Badge, Button, EmptyState, Field, Modal, Skeleton, StatusBadge } from '../../components/ui.jsx'
import { useAdmin } from './OwnerLayout.jsx'
import BookingModal from './BookingModal.jsx'

export default function BookingsPage() {
  const { bookings, reload } = useAdmin()
  const { courts } = useFacility()
  const [f, setF] = useState({ date: '', court: '', status: '', q: '' })
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)

  const rows = useMemo(() => {
    if (!bookings) return null
    const q = f.q.trim().toLowerCase()
    return bookings
      .filter((b) => (!f.date || b.date === f.date) && (!f.court || b.courtIds.includes(f.court)) && (!f.status || b.status === f.status)
        && (!q || b.customerName.toLowerCase().includes(q) || b.reference.toLowerCase().includes(q)))
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))
  }, [bookings, f])

  const live = bookings?.find((b) => b.id === open?.id)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const filtered = f.date || f.court || f.status || f.q

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold">Bookings</h1><p className="text-muted">Search, filter and manage every booking.</p></div>
        <Button variant="dark" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />Manual booking</Button>
      </div>

      <div className="card grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Search"><input className="input" type="search" placeholder="Name or reference" value={f.q} onChange={set('q')} /></Field>
        <Field label="Date"><input type="date" className="input" value={f.date} onChange={set('date')} /></Field>
        <Field label="Court">
          <select className="input" value={f.court} onChange={set('court')}><option value="">All courts</option>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={set('status')}><option value="">All statuses</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </Field>
      </div>

      {!rows ? <Skeleton className="h-64" /> : !rows.length ? (
        <EmptyState icon={SearchX} title={filtered ? 'No bookings match' : 'No bookings yet'}
          action={filtered ? <Button variant="outline" onClick={() => setF({ date: '', court: '', status: '', q: '' })}>Clear filters</Button> : null}>
          {filtered ? 'Try different filters or search terms.' : 'Bookings made by customers will appear here.'}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted" aria-live="polite">{rows.length} booking{rows.length === 1 ? '' : 's'}</p>
          {/* Desktop table */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-paper text-xs uppercase tracking-wider text-muted">
                <tr>{['Ref', 'Customer', 'When', 'Courts', 'Total', 'Payment', 'Status'].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((b) => (
                  <tr key={b.id} className="cursor-pointer hover:bg-paper/70 focus-within:bg-paper/70" onClick={() => setOpen(b)}>
                    <td className="px-4 py-3 font-mono text-xs"><button className="font-semibold underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(b) }}>{b.reference}</button></td>
                    <td className="px-4 py-3"><p className="font-medium">{b.customerName}</p><p className="text-xs text-muted">{b.customerPhone}{b.customerEmail ? ` · ${b.customerEmail}` : ''}</p></td>
                    <td className="whitespace-nowrap px-4 py-3"><p>{fmtDate(b.date)}</p><p className="text-xs text-muted">{fmtSegments(b)}</p></td>
                    <td className="px-4 py-3">{b.courtNumbers.join(', ')}</td>
                    <td className="px-4 py-3">{money(b.totalAmount)}</td>
                    <td className="px-4 py-3"><Badge tone={PAYMENT_STATUS[b.paymentStatus]?.tone}>{PAYMENT_STATUS[b.paymentStatus]?.label}</Badge>{b.needsRefund && <p className="mt-1 text-xs font-semibold text-red-700">Refund due</p>}</td>
                    <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {rows.map((b) => (
              <li key={b.id}>
                <button onClick={() => setOpen(b)} className="card w-full p-4 text-left">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{b.customerName}</p><p className="font-mono text-xs text-muted">{b.reference}</p></div><StatusBadge status={b.status} /></div>
                  <p className="mt-2 text-sm">{fmtDate(b.date)} · {fmtSegments(b)} · Court{b.courtNumbers.length > 1 ? 's' : ''} {b.courtNumbers.join(', ')}</p>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted">{money(b.totalAmount)} <Badge tone={PAYMENT_STATUS[b.paymentStatus]?.tone}>{PAYMENT_STATUS[b.paymentStatus]?.label}</Badge>{b.needsRefund && <span className="font-semibold text-red-700">Refund due</span>}</p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <BookingModal booking={live} onClose={() => setOpen(null)} onChanged={reload} />
      <ManualBooking open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload() }} />
    </div>
  )
}

export function timeOptions(settings, includeEnd) {
  const out = generateSlots(settings).map((s) => s.start)
  if (includeEnd) out.push(fromMin(toMin(settings.closingTime)))
  return out
}

function ManualBooking({ open, onClose, onCreated }) {
  return open ? <ManualForm onClose={onClose} onCreated={onCreated} /> : null
}

function ManualForm({ onClose, onCreated }) {
  const { settings, courts } = useFacility()
  const toast = useToast()
  const [form, setForm] = useState(() => ({ courtIds: [], date: todayISO(settings.timezone), start: settings.openingTime, slots: 1, name: '', phone: '', email: '', confirm: true, note: '' }))
  const [err, setErr] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const close = onClose
  const submit = async (e) => {
    e.preventDefault()
    const v = {}
    if (form.name.trim().length < 2) v.name = 'Enter the customer’s name.'
    if (!/^\d{10,15}$/.test(form.phone.replace(/\D/g, ''))) v.phone = 'Enter a valid mobile number.'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) v.email = 'Enter a valid email or leave blank.'
    if (!form.courtIds.length) v.courts = 'Select at least one court.'
    const end = fromMin(toMin(form.start) + form.slots * settings.slotMinutes)
    if (toMin(end) > toMin(settings.closingTime)) v.start = 'That runs past closing time.'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true); setErr('')
    try {
      await api.admin.createBooking({ facilityId: settings.id, courtIds: form.courtIds, date: form.date, segments: [{ start: form.start, end }], name: form.name.trim(), phone: form.phone.replace(/\D/g, ''), email: form.email.trim(), confirm: form.confirm, note: form.note.trim() })
      toast('Booking created')
      onCreated()
    } catch (x) { setErr(friendlyError(x)) } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={close} title="Create a manual booking" wide
      footer={<><Button variant="outline" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" form="manual-form" loading={busy}>Create booking</Button></>}>
      <form id="manual-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
        <fieldset className="sm:col-span-2">
          <legend className="label">Courts (one or more)</legend>
          <div className="flex flex-wrap gap-2">
            {courts.map((c) => {
              const on = form.courtIds.includes(c.id)
              return (
                <label key={c.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-semibold ${on ? 'border-forest-900 bg-forest-900 text-white' : 'border-line bg-white'}`}>
                  <input type="checkbox" className="size-4 accent-volt-400" checked={on}
                    onChange={() => setForm({ ...form, courtIds: on ? form.courtIds.filter((x) => x !== c.id) : [...form.courtIds, c.id] })} />
                  {c.name}
                </label>
              )
            })}
          </div>
          {errors.courts && <p className="mt-1.5 text-sm text-red-700">{errors.courts}</p>}
        </fieldset>
        <Field label="Date"><input type="date" className="input" value={form.date} onChange={set('date')} min={addDays(todayISO(settings.timezone), -1)} /></Field>
        <Field label="Start time" error={errors.start}><select className="input" value={form.start} onChange={set('start')}>{timeOptions(settings).map((t) => <option key={t} value={t}>{fmt12(t)}</option>)}</select></Field>
        <Field label="Duration"><select className="input" value={form.slots} onChange={(e) => setForm({ ...form, slots: Number(e.target.value) })}>{Array.from({ length: settings.maxSlotsPerBooking }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{fmtDuration(n * settings.slotMinutes)}</option>)}</select></Field>
        <Field label="Customer name" error={errors.name}><input className="input" value={form.name} onChange={set('name')} /></Field>
        <Field label="Mobile" error={errors.phone}><input className="input" type="tel" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Email (optional)" error={errors.email} className="sm:col-span-2"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Internal note (optional)" className="sm:col-span-2"><input className="input" value={form.note} onChange={set('note')} placeholder="e.g. regular, paid cash" /></Field>
        <label className="flex items-start gap-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-0.5 size-5 accent-forest-900" checked={form.confirm} onChange={set('confirm')} />
          <span><strong>Mark as confirmed</strong> (you've already received payment). Untick to create an unpaid hold instead.</span></label>
      </form>
    </Modal>
  )
}
