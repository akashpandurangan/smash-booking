import { useState } from 'react'
import { Trash2, Wrench } from 'lucide-react'
import { useFacility, useToast } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { fmt12, fmtDate, fmtRange, fromMin, toMin, todayISO } from '../../lib/time.js'
import { Alert, Button, ConfirmDialog, EmptyState, Field, Skeleton } from '../../components/ui.jsx'
import { useAdmin } from './AdminLayout.jsx'
import { timeOptions } from './BookingsPage.jsx'

export default function CourtsPage() {
  const { blocks, reload } = useAdmin()
  const { settings, courts } = useFacility()
  const toast = useToast()
  const today = todayISO(settings.timezone)
  const [f, setF] = useState({ courtId: courts[0]?.id || '', date: today, start: settings.openingTime, end: fromMin(toMin(settings.openingTime) + 60), reason: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (toMin(f.end) <= toMin(f.start)) { setErr('End time must be after the start time.'); return }
    setBusy(true); setErr('')
    try {
      const targets = f.courtId === 'all' ? courts.filter((c) => c.isActive) : [courts.find((c) => c.id === f.courtId)]
      for (const c of targets) await api.admin.createBlock({ courtId: c.id, date: f.date, start: f.start, end: f.end, reason: f.reason.trim() })
      toast(`Blocked ${targets.length > 1 ? 'all courts' : targets[0].name}`)
      setF({ ...f, reason: '' })
      reload()
    } catch (x) { setErr(friendlyError(x)); reload() } finally { setBusy(false) }
  }

  const upcoming = (blocks || []).filter((k) => k.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
  const name = (id) => courts.find((c) => c.id === id)?.name

  return (
    <div className="space-y-8">
      <div><h1 className="text-3xl font-extrabold">Courts & blocks</h1><p className="text-muted">Take a court out of service for maintenance or private use. Customers see it as unavailable.</p></div>

      <form onSubmit={submit} className="card grid gap-4 p-5 sm:grid-cols-2" noValidate>
        <h2 className="flex items-center gap-2 text-lg font-bold sm:col-span-2"><Wrench className="size-5" aria-hidden />Block a court</h2>
        {err && <Alert tone="error" className="sm:col-span-2">{err}</Alert>}
        <Field label="Court"><select className="input" value={f.courtId} onChange={set('courtId')}>{courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="all">All courts</option></select></Field>
        <Field label="Date"><input type="date" className="input" min={today} value={f.date} onChange={set('date')} /></Field>
        <Field label="From"><select className="input" value={f.start} onChange={set('start')}>{timeOptions(settings).map((t) => <option key={t} value={t}>{fmt12(t)}</option>)}</select></Field>
        <Field label="Until"><select className="input" value={f.end} onChange={set('end')}>{timeOptions(settings, true).slice(1).map((t) => <option key={t} value={t}>{fmt12(t)}</option>)}</select></Field>
        <Field label="Reason (optional)" className="sm:col-span-2"><input className="input" value={f.reason} onChange={set('reason')} placeholder="e.g. Net replacement, private coaching" /></Field>
        <div className="sm:col-span-2"><Button type="submit" variant="dark" loading={busy}>Block time</Button></div>
      </form>

      <section>
        <h2 className="mb-3 text-xl font-bold">Upcoming blocks</h2>
        {!blocks ? <Skeleton className="h-24" /> : !upcoming.length ? (
          <EmptyState icon={Wrench} title="Nothing blocked">All courts are open for booking.</EmptyState>
        ) : (
          <ul className="card divide-y divide-line">
            {upcoming.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{name(k.courtId)} · {fmtDate(k.date)}</p>
                  <p className="text-sm text-muted">{fmtRange(k.start, k.end)}{k.reason ? ` · ${k.reason}` : ''}</p>
                </div>
                <Button variant="dangerOutline" size="sm" onClick={() => setRemoving(k)} aria-label={`Remove block on ${name(k.courtId)}`}><Trash2 className="size-4" aria-hidden />Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title="Remove this block?" confirmLabel="Remove block" tone="danger"
        message="The time becomes bookable again right away."
        onConfirm={async () => { await api.admin.removeBlock(removing.id); setRemoving(null); toast('Block removed'); reload() }} />
    </div>
  )
}
