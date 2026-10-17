// Lets a FACILITY OWNER connect (or disconnect) their own Razorpay account.
// The key secret is validated against Razorpay, then stored in a table browsers can never read.
import { basicAuth, cors, json, requireUser, serviceClient } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const user = await requireUser(req)
    if (!user) return json({ error: 'not_authenticated' }, 401)

    const { facilityId, action, keyId, keySecret, webhookSecret } = await req.json()
    const db = serviceClient()

    // authorisation comes from the database relationship, never from the request body
    const { data: member } = await db.from('facility_members').select('role').eq('facility_id', facilityId).eq('user_id', user.id).maybeSingle()
    if (!member) return json({ error: 'forbidden' }, 403)

    if (action === 'remove') {
      await db.from('facility_payment_config').delete().eq('facility_id', facilityId)
      await db.from('facilities').update({ payment_mode: 'none', razorpay_key_id: null }).eq('id', facilityId)
      await db.from('audit_events').insert({ facility_id: facilityId, actor_id: user.id, actor_email: user.email, action: 'payments_disconnected', entity_type: 'facility', entity_id: facilityId, details: {} })
      return json({ ok: true })
    }

    if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(String(keyId || ''))) return json({ error: 'invalid_razorpay_key_id' }, 400)
    if (String(keySecret || '').length < 10) return json({ error: 'invalid_razorpay_key_secret' }, 400)

    // prove the credentials work before saving them
    const check = await fetch('https://api.razorpay.com/v1/orders?count=1', { headers: { Authorization: basicAuth({ keyId, keySecret }) } })
    if (!check.ok) return json({ error: 'invalid_razorpay_credentials' }, 400)

    const { error } = await db.from('facility_payment_config').upsert({
      facility_id: facilityId, razorpay_key_id: keyId, razorpay_key_secret: keySecret,
      webhook_secret: webhookSecret ? String(webhookSecret) : null, updated_at: new Date().toISOString(),
    })
    if (error) return json({ error: error.message }, 500)
    await db.from('facilities').update({ payment_mode: 'razorpay', razorpay_key_id: keyId }).eq('id', facilityId)
    const mode = keyId.startsWith('rzp_live_') ? 'live' : 'test'
    await db.from('audit_events').insert({ facility_id: facilityId, actor_id: user.id, actor_email: user.email, action: 'payments_connected', entity_type: 'facility', entity_id: facilityId, details: { mode } })
    return json({ ok: true, mode })
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500)
  }
})
