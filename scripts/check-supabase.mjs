// Safe connection test: `npm run check:supabase`. Reads .env.local, prints only pass/fail — never the key or URL.
import { readFileSync } from 'node:fs'

const env = {}
for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* file missing */ }
}
const url = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || ''
const row = (ok, msg) => console.log(ok ? '  ✓' : '  ✗', msg)
let bad = 0

row(!!url, 'VITE_SUPABASE_URL is set'); if (!url) bad++
row(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url), 'URL has the https://<project>.supabase.co shape'); if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) bad++
row(!!key, 'VITE_SUPABASE_PUBLISHABLE_KEY (or ANON_KEY) is set'); if (!key) bad++
const isSecret = /^sb_secret_/.test(key) || (key.split('.').length === 3 && /"role"\s*:\s*"service_role"/.test(Buffer.from(key.split('.')[1] || '', 'base64url').toString()))
row(!isSecret, 'key is a public key, not a secret/service_role key'); if (isSecret) bad++
if (bad) { console.log('\nFix the items above in .env.local, then re-run.'); process.exit(1) }

const headers = { apikey: key, 'Content-Type': 'application/json' }
const t = async (label, fn) => { try { const [ok, msg] = await fn(); row(ok, `${label}${msg ? ' — ' + msg : ''}`); if (!ok) bad++ } catch (e) { row(false, `${label} — network error (${e.cause?.code || e.name})`); bad++ } }

await t('Project reachable and key accepted (Auth)', async () => { const r = await fetch(`${url}/auth/v1/settings`, { headers }); return [r.ok, r.ok ? '' : `HTTP ${r.status} (check URL/key)`] })
await t('Database migrations applied (list_public_facilities)', async () => {
  const r = await fetch(`${url}/rest/v1/rpc/list_public_facilities`, { method: 'POST', headers, body: '{}' })
  if (r.ok) return [true, `${(await r.json()).length} live facilities`]
  return [false, r.status === 404 ? 'not found — run supabase/migrations 0001–0007 in the SQL editor' : `HTTP ${r.status}`]
})
console.log(bad ? '\nSome checks failed.' : '\nSupabase is connected.')
process.exit(bad ? 1 : 0)
