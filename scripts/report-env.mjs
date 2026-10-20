// Runs before every build (npm "prebuild"). Prints whether Supabase is configured for THIS build —
// variable NAMES and status only, never values — so a Vercel build log tells you why a deploy is in demo mode.
// It never fails the build: demo mode is a legitimate fallback when Supabase isn't configured.
import { readFileSync } from 'node:fs'
import { inspectSupabaseEnv } from '../src/lib/envcheck.js'

const fromFiles = {}
for (const f of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) fromFiles[m[1]] = m[2]
    }
  } catch { /* no such file */ }
}
const get = (k) => process.env[k] ?? fromFiles[k]

const r = inspectSupabaseEnv({ url: get('VITE_SUPABASE_URL'), publishableKey: get('VITE_SUPABASE_PUBLISHABLE_KEY'), anonKey: get('VITE_SUPABASE_ANON_KEY') })
const status = (k) => (get(k) === undefined || String(get(k)).trim() === '' ? 'not set' : 'set')
console.log('\n[smash-booking] Supabase configuration for this build')
console.log(`  VITE_SUPABASE_URL              ${status('VITE_SUPABASE_URL')}`)
console.log(`  VITE_SUPABASE_PUBLISHABLE_KEY  ${status('VITE_SUPABASE_PUBLISHABLE_KEY')}`)
console.log(`  VITE_SUPABASE_ANON_KEY         ${status('VITE_SUPABASE_ANON_KEY')} (legacy name, optional)`)
if (r.configured) console.log('  → REAL Supabase mode: this build will use real accounts and the real database.\n')
else {
  console.log('  → DEMO MODE: this build will NOT use real accounts.')
  for (const p of r.problems) console.log(`    - ${p}`)
  if (process.env.VERCEL) console.log(`    On Vercel: Settings → Environment Variables → enable them for "${process.env.VERCEL_ENV || 'this'}" deployments, then redeploy.`)
  console.log('')
}
