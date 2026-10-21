// Razorpay webhook: confirms bookings even if the customer closes the tab after paying.
// Each facility registers  https://<project>.supabase.co/functions/v1/razorpay-webhook?facility=<facility id>
// in ITS OWN Razorpay dashboard, with ITS OWN webhook secret. Deploy with --no-verify-jwt
// (Razorpay cannot send a Supabase JWT); authenticity comes from the per-facility HMAC signature.
import { facilityCreds, hmacHex, json, safeEqual, serviceClient } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  const facilityId = new URL(req.url).searchParams.get('facility') || ''
  if (!/^[0-9a-f-]{36}$/i.test(facilityId)) return json({ error: 'bad_facility' }, 400)

  const db = serviceClient()
  const creds = await facilityCreds(db, facilityId)
  if (!creds?.webhookSecret) return json({ error: 'webhook_not_configured' }, 503)

  const raw = await req.text()
  const sig = req.headers.get('x-razorpay-signature') || ''
  if (!safeEqual(await hmacHex(creds.webhookSecret, raw), sig)) return json({ error: 'invalid_signature' }, 400)

  const event = JSON.parse(raw)
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') return json({ ok: true, ignored: event.event })

  const pay = event.payload?.payment?.entity
  if (!pay?.order_id || !pay?.id) return json({ ok: true, ignored: 'no payment' })

  // only orders that belong to THIS facility can be settled by this facility's webhook
  const { data: order } = await db.from('orders').select('id,total_amount,razorpay_order_id')
    .eq('razorpay_order_id', pay.order_id).eq('facility_id', facilityId).maybeSingle()
  if (!order) return json({ ok: true, ignored: 'unknown order' })
  if (Number(pay.amount) !== Math.round(Number(order.total_amount) * 100)) return json({ error: 'amount_mismatch' }, 400)

  const { error } = await db.rpc('finalize_order_payment', {
    p_order_id: order.id, p_rzp_order: pay.order_id, p_rzp_payment: pay.id, p_amount: Number(order.total_amount),
  })
  // 'already_paid' etc. are not retryable; return 200 so Razorpay stops retrying.
  if (error && !/already_paid/.test(error.message)) return json({ error: error.message }, 500)
  return json({ ok: true })
})
