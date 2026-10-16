// Creates a Razorpay order for one of the caller's pending orders.
// The AMOUNT always comes from our database, never from the browser.
import { basicAuth, cors, json, razorpayCreds, requireUser, serviceClient } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const creds = razorpayCreds()
    if (!creds) return json({ error: 'razorpay_not_configured' }, 503)

    const user = await requireUser(req)
    if (!user) return json({ error: 'not_authenticated' }, 401)

    const { orderId } = await req.json()
    const db = serviceClient()
    const { data: order } = await db.from('orders').select('*').eq('id', orderId).maybeSingle()
    if (!order || order.user_id !== user.id) return json({ error: 'booking_not_found' }, 404)
    if (order.status !== 'pending_payment') return json({ error: 'booking_not_payable' }, 409)
    if (order.expires_at && new Date(order.expires_at) < new Date()) return json({ error: 'hold_expired' }, 409)

    const amount = Math.round(Number(order.total_amount) * 100) // paise
    if (order.razorpay_order_id) {
      return json({ keyId: creds.keyId, razorpayOrderId: order.razorpay_order_id, amount, currency: 'INR' })
    }

    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: basicAuth(creds), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'INR', receipt: order.reference, notes: { order_id: order.id } }),
    })
    const rz = await res.json()
    if (!res.ok) return json({ error: 'razorpay_error', detail: rz?.error?.description }, 502)

    await db.from('orders').update({ razorpay_order_id: rz.id }).eq('id', order.id)
    return json({ keyId: creds.keyId, razorpayOrderId: rz.id, amount, currency: 'INR' })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
