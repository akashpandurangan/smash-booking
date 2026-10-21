// Shared helpers for the Razorpay Edge Functions (Deno runtime).
// MULTI-TENANT: every facility brings its OWN Razorpay account. Credentials are read from
// `facility_payment_config` (service role only) using the facility id of the ORDER being paid,
// so one facility's customers can never pay into another facility's account.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

export type Creds = { keyId: string; keySecret: string; webhookSecret: string | null }

/** The Razorpay credentials of ONE facility (null if the owner has not configured payments). */
export async function facilityCreds(db: ReturnType<typeof serviceClient>, facilityId: string): Promise<Creds | null> {
  const { data } = await db.from('facility_payment_config')
    .select('razorpay_key_id, razorpay_key_secret, webhook_secret').eq('facility_id', facilityId).maybeSingle()
  if (!data) return null
  return { keyId: data.razorpay_key_id, keySecret: data.razorpay_key_secret, webhookSecret: data.webhook_secret }
}

/** Resolve the logged-in user from the request's JWT. */
export async function requireUser(req: Request) {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })
  const { data } = await client.auth.getUser()
  return data.user ?? null
}

export async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const basicAuth = (c: { keyId: string; keySecret: string }) => 'Basic ' + btoa(`${c.keyId}:${c.keySecret}`)
