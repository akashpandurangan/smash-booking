const MESSAGES = {
  slot_unavailable: 'Sorry — that court was just taken for part of this time. Please pick another slot.',
  slot_blocked: 'That court is blocked for maintenance or private use at this time.',
  slot_in_past: 'That time has already started. Please choose a later slot.',
  too_far_ahead: 'Bookings are only open a limited number of days ahead.',
  outside_operating_hours: 'That time is outside our operating hours.',
  invalid_slot: 'Please choose a valid slot length and start time.',
  invalid_time_range: 'The end time must be after the start time.',
  too_many_slots: 'That is longer than the maximum booking length.',
  no_courts_selected: 'Please select at least one court.',
  demo_payments_disabled: 'Online payment is not set up yet. Please contact the facility to complete your booking.',
  razorpay_not_configured: 'Online payment is not set up yet. Please contact the facility.',
  invalid_signature: 'We could not verify that payment. If money was deducted, contact the facility with your booking reference.',
  amount_mismatch: 'We could not verify that payment amount. If money was deducted, contact the facility with your booking reference.',
  payment_not_captured: 'Your payment has not completed yet. If money was deducted, it will be confirmed automatically or refunded.',
  already_paid: 'This booking has already been paid.',
  court_unavailable: 'That court is not available for booking.',
  not_authenticated: 'Please log in to continue.',
  invalid_name: 'Please enter your full name.',
  invalid_phone: 'Please enter a valid mobile number (10–15 digits).',
  invalid_utr: 'The UTR / transaction reference should be 8–22 letters or digits.',
  utr_already_used: 'That transaction reference has already been submitted.',
  too_many_unpaid_holds: 'You already have unpaid bookings on hold. Pay or cancel one first.',
  booking_not_found: 'Booking not found.',
  booking_not_payable: 'This booking can no longer accept a payment submission.',
  hold_expired: 'The hold on this slot expired before payment was submitted. Please book again.',
  contact_owner_to_cancel: 'Please contact the facility to cancel this booking.',
  forbidden: 'You do not have permission to do that.',
  reason_required: 'Please enter a short reason.',
  no_payment_to_review: 'There is no submitted payment to review on this booking.',
  block_conflicts_with_booking: 'There is an active booking in that time range. Cancel it first.',
  block_overlaps_block: 'That range overlaps an existing block.',
  invalid_status_transition: 'That status change is not allowed from the current state.',
  invalid_credentials: 'Incorrect email or password.',
  'Invalid login credentials': 'Incorrect email or password.',
  'Email not confirmed': 'Please verify your email first — check your inbox for the confirmation link.',
  'User already registered': 'An account with this email already exists. Try logging in.',
}

export function friendlyError(err) {
  const raw = (err && (err.message || err.error_description)) || String(err || '')
  for (const [key, msg] of Object.entries(MESSAGES)) {
    if (raw.includes(key)) return msg
  }
  if (/failed to fetch|network/i.test(raw)) return 'Network problem — check your connection and try again.'
  return raw || 'Something went wrong. Please try again.'
}
