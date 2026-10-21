import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { api } from '../../lib/api/index.js'
import { friendlyError } from '../../lib/errors.js'
import { fmtDateTime } from '../../lib/time.js'
import { useFacility } from '../../context/contexts.js'
import { Alert, EmptyState, Skeleton } from '../../components/ui.jsx'

const LABEL = {
  payment_approved: 'Approved payment',
  payment_rejected: 'Rejected payment',
  booking_confirmed: 'Confirmed booking',
  booking_cancelled: 'Cancelled booking',
  booking_created_manually: 'Created booking manually',
  court_blocked: 'Blocked a court',
  court_unblocked: 'Removed a block',
  order_confirmed: 'Confirmed booking (paid at venue)',
  order_cancelled: 'Cancelled booking',
  order_created_manually: 'Created booking manually',
  refund_recorded: 'Recorded a refund',
  settings_updated: 'Updated settings',
  facility_created: 'Created the facility',
  facility_updated: 'Updated facility settings',
  payments_connected: 'Connected Razorpay',
  payments_disconnected: 'Disconnected Razorpay',
  platform_status_suspended: 'Suspended by platform admin',
  platform_status_active: 'Activated by platform admin',
  platform_slug_changed: 'Web address changed by platform admin',
  platform_limits_changed: 'Limits changed by platform admin',
}

export default function ActivityPage() {
  const { settings } = useFacility()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.admin.listAudit(settings.id).then(setRows).catch((e) => setError(friendlyError(e))) }, [settings.id])

  return (
    <div className="space-y-5">
      <div><h1 className="text-3xl font-extrabold">Activity log</h1><p className="text-muted">Who did what, and when.</p></div>
      {error && <Alert tone="error">{error}</Alert>}
      {!rows && !error ? <Skeleton className="h-48" /> : rows && !rows.length ? (
        <EmptyState icon={History} title="No activity yet">Approvals, cancellations, blocks and settings changes are recorded here.</EmptyState>
      ) : rows && (
        <ul className="card divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <p className="font-semibold">{LABEL[r.action] || r.action}{r.details?.reference ? <span className="ml-2 font-mono text-xs font-normal text-muted">{r.details.reference}</span> : null}</p>
              <p className="text-sm text-muted">{r.actorEmail || 'unknown'} · {fmtDateTime(r.createdAt)}{r.details?.reason ? ` · “${r.details.reason}”` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
