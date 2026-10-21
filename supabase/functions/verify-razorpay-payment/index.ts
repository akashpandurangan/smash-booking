// Verifies a Razorpay checkout result server-side, then confirms the booking.
// A booking is confirmed ONLY if (1) the HMAC signature (made with THIS facility's secret) is valid
// AND (2) Razorpay's own API reports a captured payment for the right order and amount.
import { basicAuth, cors, facilityCreds, hmacHex, json, requireUser, safeEqual, serviceClient } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const user = await requireUser(req)
    if (!user) return json({ error: 'not_authenticated' }, 401)

    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json()
    if (!orderId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return json({ error: 'bad_request' }, 400)

    const db = serviceClient()
    const { data: order } = await db.from('orders').select('*').eq('id', orderId).maybeSingle()
    if (!order || order.user_id !== user.id) return json({ error: 'booking_not_found' }, 404)
    if (order.razorpay_order_id !== razorpay_order_id) return json({ error: 'razorpay_order_mismatch' }, 400)

    const creds = await facilityCreds(db, order.facility_id)
    if (!creds) return json({ error: 'razorpay_not_configured' }, 503)

    // 1. signature
    const expected = await hmacHex(creds.keySecret, `${razorpay_order_id}|${razorpay_payment_id}`)
    if (!safeEqual(expected, String(razorpay_signature))) return json({ error: 'invalid_signature' }, 400)

    // 2. ask Razorpay directly (never trust the browser's word alone)
    const headers = { Authorization: basicAuth(creds), 'Content-Type': 'application/json' }
    const amount = Math.round(Number(order.total_amount) * 100)
    let pay = await (await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, { headers })).json()
    if (pay.order_id !== razorpay_order_id || Number(pay.amount) !== amount || pay.currency !== 'INR') {
      return json({ error: 'amount_mismatch' }, 400)
    }
    if (pay.status === 'authorized') {
      pay = await (await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}/capture`, {
        method: 'POST', headers, body: JSON.stringify({ amount, currency: 'INR' }),
      })).json()
    }
    if (pay.status !== 'captured') return json({ error: 'payment_not_captured', status: pay.status }, 402)

    const { error } = await db.rpc('finalize_order_payment', {
      p_order_id: order.id, p_rzp_order: razorpay_order_id, p_rzp_payment: razorpay_payment_id, p_amount: Number(order.total_amount),
    })
    if (error) return json({ error: error.message }, 409)
    return json({ ok: true })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
