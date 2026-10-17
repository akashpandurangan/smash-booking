import { useEffect, useState } from 'react'
import { Ban, ShieldCheck, Undo2 } from 'lucide-react'
import { api } from '../../lib/api/index.js'
import { useToast } from '../../context/contexts.js'
import { PAYMENT_STATUS } from '../../lib/status.js'
import { fmtDateLong, fmtDateTime, fmtRange, money, fmtSegments } from '../../lib/time.js'
import { Alert, Badge, Button, ConfirmDialog, DetailRow, Modal, StatusBadge } from '../../components/ui.jsx'
import { StatusTimeline } from '../../components/Bits.jsx'

/** Full order details + owner actions. Every action is re-validated by the database. */
export default function BookingModal({ booking: b, onClose, onChanged }) {
  const toast = useToast()
  const [action, setAction] = useState(null) // 'confirm' | 'cancel' | 'refund'
  useEffect(() => { setAction(null) }, [b?.id])
  if (!b) return null

  const done = async (promise, msg) => {
    await promise
    toast(msg)
    setAction(null)
    onChanged()
  }
  const active = ['pending_payment', 'confirmed'].includes(b.status)
  const pay = PAYMENT_STATUS[b.paymentStatus]
  const courts = b.courtNumbers.join(', ')

  return (
    <>
      <Modal open={!action} onClose={onClose} title={`Booking ${b.reference}`} wide>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            <Badge tone={pay?.tone}>{pay?.label}</Badge>
            {b.createdByAdmin && <span className="rounded-full bg-paper px-2.5 py-1 text-xs font-semibold text-muted ring-1 ring-inset ring-line">Created manually</span>}
          </div>

          {b.needsRefund && (
            <Alert tone="warn" title="Refund needed">
              This customer paid online{b.status === 'cancelled' ? ' and the booking was cancelled' : ', but the courts could not be kept'}. Refund {money(b.totalAmount)} from your Razorpay dashboard, then record it here.
              <div className="mt-2"><Button size="sm" variant="dark" onClick={() => setAction('refund')}><Undo2 className="size-4" aria-hidden />I’ve refunded this</Button></div>
            </Alert>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <section>
              <h3 className="text-base font-bold">Booking</h3>
              <dl className="divide-y divide-line">
                <DetailRow label={b.courtNumbers.length > 1 ? 'Courts' : 'Court'}>{courts}</DetailRow>
                <DetailRow label="Date">{fmtDateLong(b.date)}</DetailRow>
                <DetailRow label="Time">{fmtSegments(b)}</DetailRow>
                <DetailRow label="Total amount">{money(b.totalAmount)}</DetailRow>
                <DetailRow label="Payment">{pay?.label}{b.paymentMethod ? ` (${b.paymentMethod})` : ''}</DetailRow>
                {b.paidAt && <DetailRow label="Paid on">{fmtDateTime(b.paidAt)}</DetailRow>}
                {b.adminNote && <DetailRow label="Owner note">{b.adminNote}</DetailRow>}
                {b.cancellationReason && <DetailRow label="Cancel reason">{b.cancellationReason}</DetailRow>}
              </dl>
            </section>
            <section>
              <h3 className="text-base font-bold">Customer</h3>
              <dl className="divide-y divide-line">
                <DetailRow label="Name">{b.customerName}</DetailRow>
                <DetailRow label="Mobile"><a className="text-forest-600 underline" href={`tel:${b.customerPhone}`}>{b.customerPhone}</a></DetailRow>
                <DetailRow label="Email">{b.customerEmail || '—'}</DetailRow>
                <DetailRow label="Created">{fmtDateTime(b.createdAt)}</DetailRow>
              </dl>
              {!b.createdByAdmin && <div className="mt-4"><StatusTimeline booking={b} /></div>}
            </section>
          </div>

          {active && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              {b.status === 'pending_payment' && <Button variant="dark" onClick={() => setAction('confirm')}><ShieldCheck className="size-4" aria-hidden />Confirm (paid at venue)…</Button>}
              <Button variant="dangerOutline" onClick={() => setAction('cancel')}><Ban className="size-4" aria-hidden />Cancel booking…</Button>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog open={action === 'confirm'} onClose={() => setAction(null)} title="Confirm without online payment?" confirmLabel="Confirm booking"
        requireReason reasonLabel="Why (e.g. cash received at venue)"
        message="Use this when you’ve received payment outside the app. It’s recorded in the activity log."
        onConfirm={(reason) => done(api.admin.setStatus(b.id, 'confirmed', reason), 'Booking confirmed')} />
      <ConfirmDialog open={action === 'cancel'} onClose={() => setAction(null)} title="Cancel this booking?" tone="danger" confirmLabel="Cancel booking"
        requireReason reasonLabel="Cancellation reason"
        message={`Court${b.courtNumbers.length > 1 ? 's' : ''} ${courts} (${fmtSegments(b)}) will be released.${b.paymentStatus === 'paid' ? ' The customer paid online — you’ll be asked to record the refund afterwards.' : ''} The app does not move money.`}
        onConfirm={(reason) => done(api.admin.setStatus(b.id, 'cancelled', reason), 'Booking cancelled')} />
      <ConfirmDialog open={action === 'refund'} onClose={() => setAction(null)} title="Record refund" confirmLabel="Mark as refunded"
        message={`Confirm you have refunded ${money(b.totalAmount)} to ${b.customerName} in your Razorpay dashboard.`}
        onConfirm={() => done(api.admin.markRefunded(b.id), 'Refund recorded')} />
    </>
  )
}
