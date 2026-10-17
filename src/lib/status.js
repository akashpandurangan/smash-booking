// Order status model (mirrors the DB trigger `enforce_order_transition`).
export const STATUS = {
  pending_payment: { label: 'Awaiting payment', tone: 'amber' },
  confirmed: { label: 'Confirmed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
  expired: { label: 'Expired', tone: 'slate' },
}

export const PAYMENT_STATUS = {
  unpaid: { label: 'Unpaid', tone: 'amber' },
  paid: { label: 'Paid online', tone: 'green' },
  offline: { label: 'Paid at venue', tone: 'green' },
  demo: { label: 'Demo payment', tone: 'blue' },
  refunded: { label: 'Refunded', tone: 'slate' },
}

export const FACILITY_STATUS = {
  draft: { label: 'Draft', tone: 'slate' },
  pending: { label: 'Awaiting approval', tone: 'amber' },
  active: { label: 'Live', tone: 'green' },
  suspended: { label: 'Suspended', tone: 'red' },
}

export const TRANSITIONS = {
  pending_payment: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['cancelled'],
  cancelled: [],
  expired: [],
}

export const ACTIVE_STATUSES = ['pending_payment', 'confirmed']

/** Customer timeline: booking created → awaiting payment → payment verified → confirmed */
export function timelineFor(b) {
  const paid = ['paid', 'offline', 'demo', 'refunded'].includes(b.paymentStatus)
  const steps = [
    { key: 'created', label: 'Booking created', at: b.createdAt, state: 'done' },
    { key: 'awaiting', label: 'Awaiting payment', state: b.status === 'pending_payment' ? 'current' : 'done' },
    {
      key: 'paid',
      label: b.paymentStatus === 'offline' ? 'Payment received at venue' : b.paymentStatus === 'demo' ? 'Demo payment' : 'Payment verified',
      at: b.paidAt,
      state: paid ? 'done' : 'todo',
    },
    { key: 'confirmed', label: 'Confirmed', at: b.confirmedAt, state: b.confirmedAt ? 'done' : 'todo' },
  ]
  if (b.status === 'cancelled' || b.status === 'expired') {
    return steps
      .map((s) => (s.state === 'current' ? { ...s, state: 'stopped' } : s))
      .concat({
        key: 'end',
        label: b.status === 'expired' ? 'Hold expired' : 'Cancelled',
        at: b.cancelledAt,
        state: 'stopped',
        note: b.cancellationReason || (b.status === 'expired' ? 'The unpaid hold ran out and the slot was released.' : null),
      })
  }
  return steps
}
