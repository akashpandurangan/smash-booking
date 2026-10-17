import { Clock, PauseCircle, Settings2 } from 'lucide-react'
import { FACILITY_STATUS } from '../lib/status.js'
import { bookingUrl, workingUrl } from '../lib/tenant.js'
import { Alert, Badge, Button, Skeleton } from './ui.jsx'
import LinkActions from './LinkActions.jsx'

/** What is still missing before a facility can take bookings, and where to fix it. */
export function setupGaps(settings, courts) {
  const gaps = []
  if (!courts?.some((c) => c.isActive)) gaps.push({ text: 'Add at least one active court.', to: '/owner/courts' })
  if (!(settings.pricePerSlot > 0)) gaps.push({ text: 'Set a price per hour.', to: '/owner/settings' })
  if (!settings.availableDurations?.length) gaps.push({ text: 'Choose which durations players can book.', to: '/owner/settings' })
  if (settings.status === 'draft' && !gaps.length) gaps.push({ text: 'Review your facility details and activate it.', to: '/owner/settings' })
  return gaps
}

/**
 * "Your Booking Link" — the single place owners find, copy, preview and share their player link.
 * The link is only presented as active when setup is complete AND the platform has the facility live;
 * otherwise the owner gets the right next action instead.
 */
export default function BookingLinkCard({ settings, courts, className = '' }) {
  if (!settings) return <Skeleton className={`h-40 ${className}`} />
  const gaps = setupGaps(settings, courts)
  const st = FACILITY_STATUS[settings.status]
  const url = bookingUrl(settings.slug)

  return (
    <section className={`card p-4 sm:p-5 ${className}`} aria-label="Your Booking Link">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-normal text-muted">Your Booking Link</h2>
        {st && <Badge tone={st.tone}>{st.label}</Badge>}
      </div>

      {gaps.length > 0 ? (
        <div className="mt-2">
          <Alert tone="warn" title="Your booking link isn’t active yet">
            Players can’t use it until setup is complete.
            <ul className="mt-1 list-disc pl-5">{gaps.map((g) => <li key={g.text}>{g.text}</li>)}</ul>
          </Alert>
          <Button to={gaps[0].to} className="mt-3" size="sm"><Settings2 className="size-4" aria-hidden />Complete Facility Setup</Button>
        </div>
      ) : (
        <>
          <p className="mt-0.5 break-all font-display text-xl font-bold">{url}</p>
          {settings.status === 'active' ? (
            <LinkActions className="mt-3" url={url} previewUrl={workingUrl(settings.slug)} name={settings.name} />
          ) : (
            <>
              <p className="mt-2 flex items-start gap-2 text-sm text-muted">
                {settings.status === 'suspended' ? <PauseCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />}
                {settings.status === 'suspended'
                  ? 'Reserved for you, but bookings are paused by the platform. Don’t share it yet.'
                  : 'Reserved for you. It goes live as soon as a platform administrator approves your facility — only you can preview it until then.'}
              </p>
              <Button as="a" href={workingUrl(settings.slug)} target="_blank" rel="noreferrer" variant="outline" size="sm" className="mt-3">Preview booking page</Button>
            </>
          )}
        </>
      )}
    </section>
  )
}
