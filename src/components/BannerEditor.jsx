import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '../lib/api/index.js'
import { friendlyError } from '../lib/errors.js'
import { Alert, Button, Field } from './ui.jsx'
import ImagePicker from './ImagePicker.jsx'

const MAX = 3
const blank = () => ({ key: Math.random().toString(36).slice(2), imageUrl: '', heading: '', description: '', ctaLabel: '' })
const fromSaved = (list) => list.map((b) => ({ key: Math.random().toString(36).slice(2), imageUrl: b.imageUrl, heading: b.heading || '', description: b.description || '', ctaLabel: b.ctaLabel || '' }))

/** Owner-managed promotional banners for ONE facility (max 3): upload, replace, reorder, remove, edit text. */
export default function BannerEditor({ facilityId, saved, onSaved, toast }) {
  const [items, setItems] = useState(() => fromSaved(saved))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(items.map(({ key, ...r }) => r)) !== JSON.stringify(saved.map((b) => ({ imageUrl: b.imageUrl, heading: b.heading || '', description: b.description || '', ctaLabel: b.ctaLabel || '' })))

  const patch = (i, p) => setItems((l) => l.map((b, k) => (k === i ? { ...b, ...p } : b)))
  const move = (i, d) => setItems((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n })

  const save = async () => {
    setError('')
    if (items.some((b) => !b.imageUrl)) { setError('Every banner needs an image. Add one or remove the empty banner.'); return }
    setBusy(true)
    try {
      await api.owner.saveBanners(facilityId, items.map(({ key, ...r }) => r))
      await onSaved()
      toast('Banners saved')
    } catch (x) {
      setError(friendlyError(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="banners-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="banners-h" className="text-lg font-bold">Promotional banners</h2>
          <p className="mt-1 text-sm text-muted">Up to {MAX} banners appear at the top of your booking page, with your text and button on the left and the image on the right (16:9 images look best). With none, a default header is shown.</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={items.length >= MAX} onClick={() => setItems((l) => [...l, blank()])}><Plus className="size-4" aria-hidden />Add banner</Button>
      </div>
      {error && <Alert tone="error" className="mt-4">{error}</Alert>}

      {items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No banners yet. Add one to promote an offer, a tournament or your facility.</p>
      ) : (
        <ol className="mt-4 space-y-5">
          {items.map((b, i) => (
            <li key={b.key} className="rounded-2xl border border-line p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="font-semibold">Banner {i + 1}</p>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move banner ${i + 1} up`}><ArrowUp className="size-4" aria-hidden /></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move banner ${i + 1} down`}><ArrowDown className="size-4" aria-hidden /></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setItems((l) => l.filter((_, k) => k !== i))} aria-label={`Remove banner ${i + 1}`}><Trash2 className="size-4" aria-hidden />Remove</Button>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <ImagePicker label={`Banner ${i + 1} image`} value={b.imageUrl} upload={(file) => api.owner.uploadImage(facilityId, file, 'banner')}
                  onUploaded={(url) => patch(i, { imageUrl: url })} onRemove={() => patch(i, { imageUrl: '' })} />
                <div className="space-y-3">
                  <Field label="Heading" hint={`${b.heading.length}/80`}><input className="input" maxLength={80} value={b.heading} onChange={(e) => patch(i, { heading: e.target.value })} placeholder="e.g. Weekend morning offer" /></Field>
                  <Field label="Description" hint={`${b.description.length}/200`}><textarea className="input min-h-20" maxLength={200} value={b.description} onChange={(e) => patch(i, { description: e.target.value })} /></Field>
                  <Field label="Button text" hint="Takes players to the booking section. Defaults to “Book a court”."><input className="input" maxLength={30} value={b.ctaLabel} onChange={(e) => patch(i, { ctaLabel: e.target.value })} placeholder="Book a court" /></Field>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} loading={busy} disabled={!dirty}><Save className="size-4" aria-hidden />Save banners</Button>
        {dirty && <Button type="button" variant="ghost" onClick={() => { setItems(fromSaved(saved)); setError('') }} disabled={busy}>Discard changes</Button>}
        {!dirty && saved.length > 0 && <span className="text-sm text-muted">All changes saved.</span>}
      </div>
    </section>
  )
}
