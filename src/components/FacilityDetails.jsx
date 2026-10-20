import { Banknote, CalendarOff, Clock, Info, MapPin, Navigation, Phone, ShieldCheck } from 'lucide-react'
import { AMENITY_LABEL } from '../lib/amenities.js'
import { isDemo } from '../lib/config.js'
import { directionsUrl } from '../lib/maps.js'
import { courtHourlyPrice } from '../lib/pricing.js'
import { WEEKDAYS, fmt12, money } from '../lib/time.js'

/** Everything a player wants to know before booking: about, where, when, courts & prices, policies. */
export default function FacilityDetails({ settings, courts }) {
  const place = [settings.address, settings.locality, settings.city, settings.postalCode].filter(Boolean).join(', ')
  const directions = directionsUrl(settings)
  const offDays = settings.closedWeekdays.slice().sort((a, b) => a - b).map((d) => WEEKDAYS[d])
  const online = !isDemo && settings.paymentMode === 'razorpay'
  const bookable = courts.filter((c) => c.isActive)

  return (
    <section id="about" className="container-page scroll-mt-20 pt-12" aria-labelledby="about-h">
      <h2 id="about-h" className="text-2xl font-extrabold sm:text-3xl">About {settings.name}</h2>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          {settings.coverImageUrl && (
            <img src={settings.coverImageUrl} alt={`${settings.name} courts`} width="1280" height="720" loading="lazy" decoding="async" className="aspect-video w-full rounded-2xl bg-paper object-cover" />
          )}
          {settings.description
            ? <p className="whitespace-pre-line text-base leading-relaxed text-ink/90">{settings.description}</p>
            : <p className="text-sm text-muted">The owner hasn’t added a description yet.</p>}
          {settings.amenities.length > 0 && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted">Amenities</h3>
              <ul className="mt-2 flex flex-wrap gap-2">{settings.amenities.map((a) => <li key={a} className="rounded-full border border-line bg-white px-3 py-1.5 text-sm">{AMENITY_LABEL[a] || a}</li>)}</ul>
            </div>
          )}
        </div>

        <div className="card divide-y divide-line self-start">
          <div className="p-5">
            <h3 className="flex items-center gap-2 font-bold"><MapPin className="size-4 text-forest-600" aria-hidden />Location</h3>
            <p className="mt-1 text-sm text-muted">{place || 'Address not set yet'}</p>
            {directions && (
              <a href={directions} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-paper">
                <Navigation className="size-4" aria-hidden />Get directions<span className="sr-only"> (opens Google Maps)</span>
              </a>
            )}
            {settings.contactPhone && <p className="mt-3 flex items-center gap-2 text-sm"><Phone className="size-4 text-forest-600" aria-hidden /><a className="hover:underline" href={`tel:${settings.contactPhone}`}>{settings.contactPhone}</a></p>}
          </div>

          <div className="p-5">
            <h3 className="flex items-center gap-2 font-bold"><Clock className="size-4 text-forest-600" aria-hidden />Opening hours</h3>
            <p className="mt-1 text-sm text-muted">{offDays.length === 7 ? 'Currently closed' : `${fmt12(settings.openingTime)} – ${fmt12(settings.closingTime)}, ${offDays.length ? `closed on ${offDays.join(', ')}` : 'open every day'}`}</p>
            {settings.holidays.length > 0 && <p className="mt-1 flex items-center gap-2 text-sm text-muted"><CalendarOff className="size-4 shrink-0" aria-hidden />{settings.holidays.length} upcoming holiday closure{settings.holidays.length > 1 ? 's' : ''} (greyed out when you pick a date)</p>}
          </div>

          <div className="p-5">
            <h3 className="flex items-center gap-2 font-bold"><Banknote className="size-4 text-forest-600" aria-hidden />Courts &amp; prices</h3>
            {bookable.length === 0 ? <p className="mt-1 text-sm text-muted">No courts are open for booking right now.</p> : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {bookable.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2"><span className="font-medium">{c.name}</span><span className="text-muted"><strong className="text-ink">{money(courtHourlyPrice(c, settings))}</strong> / hour</span></li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-5">
            <h3 className="flex items-center gap-2 font-bold"><ShieldCheck className="size-4 text-forest-600" aria-hidden />Payment &amp; cancellation</h3>
            <p className="mt-1 text-sm text-muted">
              {online ? 'Pay securely online (UPI, cards, netbanking). Your booking is confirmed once the payment is verified.'
                : settings.allowDemoPayments ? 'This facility is using test payments — no real money is taken.'
                : 'Online payment isn’t set up for this facility yet, so a reserved slot can’t be paid for online. Contact the facility.'}
            </p>
            <p className="mt-2 flex items-start gap-2 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{settings.cancellationPolicy}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
