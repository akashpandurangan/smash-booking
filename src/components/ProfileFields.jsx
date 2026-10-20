import { useState } from 'react'
import { ExternalLink, LocateFixed } from 'lucide-react'
import { AMENITIES } from '../lib/amenities.js'
import { isValidMapsUrl } from '../lib/maps.js'
import { Button, Field } from './ui.jsx'

/**
 * About / location / amenities fields (controlled). Latitude & longitude are optional: owners with a Maps link
 * don't need them, but they make "near me" search accurate. `value` is a profile object (see lib/profile.js).
 */
export default function ProfileFields({ value: v, onChange, errors = {} }) {
  const [geo, setGeo] = useState({ busy: false, error: '' })
  const set = (k) => (e) => onChange({ [k]: e.target.value })
  const toggleAmenity = (key) => onChange({ amenities: v.amenities.includes(key) ? v.amenities.filter((a) => a !== key) : [...v.amenities, key] })

  const here = () => {
    if (!navigator.geolocation) { setGeo({ busy: false, error: 'This browser can’t share its location.' }); return }
    setGeo({ busy: true, error: '' })
    navigator.geolocation.getCurrentPosition(
      (p) => { onChange({ latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) }); setGeo({ busy: false, error: '' }) },
      () => setGeo({ busy: false, error: 'Couldn’t get your location. Enter the coordinates by hand or skip them.' }),
      { timeout: 10000 },
    )
  }
  const mapsOk = v.mapsUrl.trim() && isValidMapsUrl(v.mapsUrl)

  return (
    <>
      <Field label="Description" error={errors.description} hint="What makes your facility good to play at? Floors, lighting, coaching… (optional, up to 2,000 characters)" className="sm:col-span-2">
        <textarea className="input min-h-28" maxLength={2000} value={v.description} onChange={set('description')} />
      </Field>
      <Field label="Locality / area" error={errors.locality} hint="e.g. Baner, Anna Nagar"><input className="input" value={v.locality} onChange={set('locality')} autoComplete="off" /></Field>
      <Field label="PIN code" error={errors.postalCode}><input className="input" inputMode="numeric" maxLength={6} value={v.postalCode} onChange={set('postalCode')} autoComplete="postal-code" /></Field>
      <div className="sm:col-span-2">
        <Field label="Google Maps link" error={errors.mapsUrl} hint="In Google Maps open your venue, tap Share, copy the link and paste it here. Players get a Directions button.">
          <input className="input" type="url" inputMode="url" value={v.mapsUrl} onChange={set('mapsUrl')} placeholder="https://maps.app.goo.gl/…" />
        </Field>
        {mapsOk && <a href={v.mapsUrl.trim()} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-forest-600 hover:underline"><ExternalLink className="size-3.5" aria-hidden />Test this link<span className="sr-only"> (opens Google Maps)</span></a>}
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="label">Exact location <span className="font-normal text-muted">(optional — lets “near me” search sort by distance)</span></legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Latitude" error={errors.latitude}><input className="input" inputMode="decimal" value={v.latitude} onChange={set('latitude')} placeholder="18.559000" /></Field>
          <Field label="Longitude"><input className="input" inputMode="decimal" value={v.longitude} onChange={set('longitude')} placeholder="73.779000" /></Field>
          <Button type="button" variant="outline" onClick={here} loading={geo.busy}><LocateFixed className="size-4" aria-hidden />I’m at the venue</Button>
        </div>
        {geo.error && <p className="mt-1.5 text-sm text-red-700" role="alert">{geo.error}</p>}
        <p className="mt-1.5 text-xs text-muted">Coordinates are shown publicly only as a distance and a Maps link, the same as your address.</p>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="label">Amenities <span className="font-normal text-muted">(tick only what you really offer)</span></legend>
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map(({ key, label }) => {
            const on = v.amenities.includes(key)
            return (
              <button key={key} type="button" aria-pressed={on} onClick={() => toggleAmenity(key)}
                className={`min-h-10 rounded-xl border px-3 text-sm font-semibold ${on ? 'border-forest-900 bg-forest-900 text-white' : 'border-line bg-white hover:border-forest-600'}`}>{label}</button>
            )
          })}
        </div>
      </fieldset>
    </>
  )
}
