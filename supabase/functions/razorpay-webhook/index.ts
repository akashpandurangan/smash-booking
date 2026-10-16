// Razorpay webhook: confirms bookings even if the customer closes the tab after paying.
// Deploy with --no-verify-jwt (Razorpay can't send a Supabase JWT); authenticity comes from the signature.
import { hmacHex, json, safeEqual, serviceClient } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  if (!secret) return json({ error: 'webhook_not_configured' }, 503)

  const raw = await req.text()
  const sig = req.headers.get('x-razorpay-signature') || ''
  if (!safeEqual(await hmacHex(secret, raw), sig)) return json({ error: 'invalid_signature' }, 400)

  const event = JSON.parse(raw)
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') return json({ ok: true, ignored: event.event })

  const pay = event.payload?.payment?.entity
  if (!pay?.order_id || !pay?.id) return json({ ok: true, ignored: 'no payment' })

  const db = serviceClient()
  const { data: order } = await db.from('orders').select('id,total_amount,razorpay_order_id').eq('razorpay_order_id', pay.order_id).maybeSingle()
  if (!order) return json({ ok: true, ignored: 'unknown order' })
  if (Number(pay.amount) !== Math.round(Number(order.total_amount) * 100)) return json({ error: 'amount_mismatch' }, 400)

  const { error } = await db.rpc('finalize_order_payment', {
    p_order_id: order.id, p_rzp_order: pay.order_id, p_rzp_payment: pay.id, p_amount: Number(order.total_amount),
  })
  // 'already_paid' etc. are not retryable; return 200 so Razorpay stops retrying.
  if (error && !/already_paid/.test(error.message)) return json({ error: error.message }, 500)
  return json({ ok: true })
})
