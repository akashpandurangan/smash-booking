// Validation of the public Supabase settings. Pure (no import.meta / window) so the app, the build
// report and the unit tests all share it. It only ever reports variable NAMES, never values.

const clean = (v) => String(v ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').trim()

const decodeJwtRole = (token) => {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(globalThis.atob(p + '='.repeat((4 - (p.length % 4)) % 4))).role
  } catch {
    return null
  }
}

/** @returns {{ url: string, key: string, configured: boolean, problems: string[] }} */
export function inspectSupabaseEnv({ url, publishableKey, anonKey }) {
  const problems = []
  const u = clean(url).replace(/\/+$/, '')
  const k = clean(publishableKey) || clean(anonKey)

  if (!u) problems.push('VITE_SUPABASE_URL is not set in this build.')
  else if (!/^https?:\/\/[^\s/]+$/i.test(u)) problems.push('VITE_SUPABASE_URL must be just the project URL, like https://<project>.supabase.co (no extra text or path).')

  let key = k
  if (!k) problems.push('No key: set VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) in this build.')
  else if (/^sb_secret_/.test(k) || decodeJwtRole(k) === 'service_role') {
    problems.push('The key is a SECRET (service_role) key. It must never be used in a browser app, so it was ignored — use the publishable (or anon) key.')
    key = ''
  } else if (k.length < 20) problems.push('The Supabase key looks incomplete (too short) — copy the whole publishable key.')

  const configured = problems.length === 0
  return { url: configured ? u : '', key: configured ? key : '', configured, problems }
}
