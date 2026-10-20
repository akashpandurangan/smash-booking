import { useState } from 'react'
import { CheckCircle2, Clock, Globe, MessageCircle, ShieldAlert } from 'lucide-react'
import { useFacility, useToast } from '../../context/contexts.js'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { ROOT_DOMAIN, WILDCARD_READY, bookingLink, subdomainUrl } from '../../lib/tenant.js'
import { Alert, Button, Field } from '../../components/ui.jsx'
import BookingLinkCard from '../../components/BookingLinkCard.jsx'
import { LOGO_URL } from '../../lib/config.js'
import { useAdmin } from './OwnerLayout.jsx'

/** The facility's public link, subdomain status and branding. */
export default function BookingPagePage() {
  const { settings, courts } = useFacility()
  const { reloadFacility } = useAdmin()
  const toast = useToast()
  const [b, setB] = useState({ logoUrl: settings.logoUrl, tagline: settings.tagline })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const link = bookingLink(settings.slug)
  const url = link.url
  const live = settings.status === 'active'
  const brandedLive = live && WILDCARD_READY

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    if (b.logoUrl && !/^https:\/\//.test(b.logoUrl.trim())) { setErr('Logo must be an https:// image link.'); return }
    setBusy(true)
    try { await api.owner.updateFacility(settings.id, { logoUrl: b.logoUrl.trim(), tagline: b.tagline }); toast('Branding saved'); reloadFacility() } catch (x) { setErr(friendlyError(x)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-extrabold">Booking page</h1><p className="text-muted">Your public booking website: link, status and branding.</p></div>

      <BookingLinkCard settings={settings} courts={courts} />
      {settings.status === 'active' && link.shareable && (
        <a className="-mt-3 inline-flex items-center gap-2 text-sm font-semibold text-forest-600 hover:underline" target="_blank" rel="noreferrer"
          href={`https://wa.me/?text=${encodeURIComponent(`Book a badminton court at ${settings.name}: ${url}`)}`}><MessageCircle className="size-4" aria-hidden />Share on WhatsApp</a>
      )}

      <section className="card p-5 sm:p-6" aria-labelledby="sub-h">
        <h2 id="sub-h" className="flex items-center gap-2 text-lg font-bold"><Globe className="size-5" aria-hidden />Web address status</h2>
        <ul className="mt-4 space-y-3 text-sm">
          <li className="flex gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden /><span><strong>Address reserved:</strong> <code>{settings.slug}.{ROOT_DOMAIN}</code> belongs to you. Nobody else can register it.</span></li>
          <li className="flex gap-3">{live ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden /> : <Clock className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />}<span><strong>Booking page:</strong> {live ? 'live and accepting bookings.' : settings.status === 'pending' ? 'waiting for platform approval.' : settings.status === 'suspended' ? 'suspended by the platform.' : 'not live yet.'}</span></li>
          <li className="flex gap-3">{brandedLive ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden /> : <Clock className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />}
            <span><strong>Branded subdomain:</strong> {WILDCARD_READY ? <>connected — <a className="underline" href={subdomainUrl(settings.slug)}>{subdomainUrl(settings.slug)}</a></> : <>not connected yet. Until the platform connects <code>{ROOT_DOMAIN}</code>, your booking link above is the one to use{link.shareable ? '' : ' (it becomes shareable once this app is deployed)'}. Nothing to do on your side.</>}</span></li>
        </ul>
        {!live && <Alert tone="warn" className="mt-4" title="Players can’t see your page yet">Only you can preview it. {settings.status === 'pending' ? 'You’ll go live as soon as a platform administrator approves your facility.' : ''}</Alert>}
        <p className="mt-4 flex gap-2 text-xs text-muted"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />Your web address can only be changed by a platform administrator, so shared links never break unexpectedly.</p>
      </section>

      <form onSubmit={save} className="card p-5 sm:p-6" noValidate>
        <h2 className="text-lg font-bold">Branding</h2>
        {err && <Alert tone="error" className="mt-3">{err}</Alert>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Tagline"><input className="input" value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} /></Field>
          <Field label="Logo image link" hint="https link; shown in your page header."><input className="input" value={b.logoUrl} placeholder="https://…" onChange={(e) => setB({ ...b, logoUrl: e.target.value })} /></Field>
        </div>
        <div className="on-dark mt-4 flex items-center gap-3 rounded-2xl bg-forest-900 p-4 text-white">
          <img src={b.logoUrl.trim().startsWith('https://') ? b.logoUrl.trim() : LOGO_URL} alt="" className="size-10 rounded-xl bg-white object-cover" />
          <div className="min-w-0"><p className="truncate font-display text-lg font-bold">{settings.name}</p><p className="truncate text-sm text-volt-400">{b.tagline}</p></div>
        </div>
        <Button type="submit" className="mt-4" loading={busy}>Save branding</Button>
      </form>
    </div>
  )
}
