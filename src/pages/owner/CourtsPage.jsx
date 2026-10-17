import { useState } from 'react'
import { ImageOff, Plus, Trash2, Wrench } from 'lucide-react'
import { useFacility, useToast } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { fmt12, fmtDate, fmtRange, fromMin, toMin, todayISO } from '../../lib/time.js'
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Field, Skeleton } from '../../components/ui.jsx'
import { useAdmin } from './OwnerLayout.jsx'
import { timeOptions } from './BookingsPage.jsx'

/** Court management (names, images, active/inactive, add/remove within the plan) + maintenance blocks. */
export default function CourtsPage() {
  const { blocks, reload, reloadFacility } = useAdmin()
  const { settings, courts } = useFacility()
  const toast = useToast()
  const today = todayISO(settings.timezone)
  const [f, setF] = useState({ courtId: courts[0]?.id || '', date: today, start: settings.openingTime, end: fromMin(toMin(settings.openingTime) + 60), reason: '' })
  const [err, setErr] = useState('')
  const [courtErr, setCourtErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [removingCourt, setRemovingCourt] = useState(null)
  const [newCourt, setNewCourt] = useState({ name: '', imageUrl: '' })
  const [edits, setEdits] = useState({}) // courtId → { name, imageUrl }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const saveCourt = async (c) => {
    const e = edits[c.id]
    if (!e) return
    setCourtErr('')
    if (!e.name.trim()) { setCourtErr('A court needs a name.'); return }
    if (e.imageUrl && !/^https:\/\//.test(e.imageUrl.trim())) { setCourtErr('Court images must be https:// links.'); return }
    try {
      await api.owner.updateCourt(c.id, { name: e.name.trim(), imageUrl: e.imageUrl.trim() })
      setEdits(({ [c.id]: _gone, ...rest }) => rest)
      toast('Court updated')
      reloadFacility()
    } catch (x) { setCourtErr(friendlyError(x)) }
  }
  const addCourt = async () => {
    setCourtErr('')
    if (newCourt.imageUrl && !/^https:\/\//.test(newCourt.imageUrl.trim())) { setCourtErr('Court images must be https:// links.'); return }
    try {
      await api.owner.addCourt(settings.id, { name: newCourt.name.trim(), imageUrl: newCourt.imageUrl.trim() })
      setNewCourt({ name: '', imageUrl: '' })
      toast('Court added')
      reloadFacility()
    } catch (x) { setCourtErr(friendlyError(x)) }
  }
  const toggleActive = async (c) => {
    try { await api.owner.updateCourt(c.id, { isActive: !c.isActive }); toast(c.isActive ? `${c.name} hidden from booking` : `${c.name} is bookable again`); reloadFacility() } catch (x) { setCourtErr(friendlyError(x)) }
  }

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
      <div><h1 className="text-3xl font-extrabold">Courts & blocks</h1><p className="text-muted">Manage your courts, and take a court out of service for maintenance or private use.</p></div>

      <section className="card p-5" aria-labelledby="courts-h">
        <div className="flex items-baseline justify-between gap-3"><h2 id="courts-h" className="text-lg font-bold">Your courts</h2><span className="text-sm text-muted">{courts.length} of {settings.maxCourts} on your plan</span></div>
        {courtErr && <Alert tone="error" className="mt-3">{courtErr}</Alert>}
        <ul className="mt-4 space-y-3">
          {courts.map((c) => {
            const e = edits[c.id] || { name: c.name, imageUrl: c.imageUrl }
            const dirty = edits[c.id] && (e.name !== c.name || e.imageUrl !== c.imageUrl)
            return (
              <li key={c.id} className="rounded-2xl border border-line p-3 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-[auto_1fr_1.3fr_auto] sm:items-end">
                  <div className="grid size-12 place-items-center overflow-hidden rounded-xl bg-paper text-muted">{c.imageUrl ? <img src={c.imageUrl} alt="" className="size-full object-cover" /> : <ImageOff className="size-5" aria-hidden />}</div>
                  <Field label="Name"><input className="input" value={e.name} onChange={(ev) => setEdits({ ...edits, [c.id]: { ...e, name: ev.target.value } })} /></Field>
                  <Field label="Image link (optional)"><input className="input" value={e.imageUrl} placeholder="https://…" onChange={(ev) => setEdits({ ...edits, [c.id]: { ...e, imageUrl: ev.target.value } })} /></Field>
                  <div className="flex flex-wrap gap-2">
                    {dirty && <Button size="sm" onClick={() => saveCourt(c)}>Save</Button>}
                    <Button size="sm" variant="outline" onClick={() => toggleActive(c)}>{c.isActive ? 'Hide' : 'Show'}</Button>
                    <Button size="sm" variant="dangerOutline" onClick={() => setRemovingCourt(c)} aria-label={`Delete ${c.name}`}><Trash2 className="size-4" aria-hidden /></Button>
                  </div>
                </div>
                {!c.isActive && <Badge tone="slate" className="mt-2">Hidden from players</Badge>}
              </li>
            )
          })}
        </ul>
        <div className="mt-4 grid gap-3 rounded-2xl bg-paper p-3 sm:grid-cols-[1fr_1.3fr_auto] sm:items-end sm:p-4">
          <Field label="New court name"><input className="input" value={newCourt.name} onChange={(e) => setNewCourt({ ...newCourt, name: e.target.value })} placeholder={`Court ${Math.max(0, ...courts.map((c) => c.number)) + 1}`} /></Field>
          <Field label="Image link (optional)"><input className="input" value={newCourt.imageUrl} onChange={(e) => setNewCourt({ ...newCourt, imageUrl: e.target.value })} placeholder="https://…" /></Field>
          <Button onClick={addCourt} disabled={courts.length >= settings.maxCourts}><Plus className="size-4" aria-hidden />Add court</Button>
        </div>
        {courts.length >= settings.maxCourts && <p className="mt-2 text-sm text-muted">You’ve reached your plan’s court limit. Contact the platform team to raise it.</p>}
      </section>

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
      <ConfirmDialog open={!!removingCourt} onClose={() => setRemovingCourt(null)} title={`Delete ${removingCourt?.name}?`} confirmLabel="Delete court" tone="danger"
        message="This only works for courts that have never had a booking or block. To stop players booking a court that has history, use Hide instead."
        onConfirm={async () => { await api.owner.removeCourt(removingCourt.id); setRemovingCourt(null); toast('Court deleted'); reloadFacility() }} />
    </div>
  )
}
