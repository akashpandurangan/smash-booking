// Public configuration only. NEVER put a Supabase service_role key in a VITE_ variable.
import { inspectSupabaseEnv } from './envcheck.js'

// Vite inlines VITE_* values at BUILD time: changing them in Vercel only takes effect after a redeploy.
const env = inspectSupabaseEnv({
  url: import.meta.env.VITE_SUPABASE_URL,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, // new-style key (sb_publishable_…)
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY, // legacy name — either works
})

export const supabaseConfigured = env.configured
// Demo mode is only a fallback for "Supabase not configured". It is never switched on by anything else.
export const isDemo = !supabaseConfigured
export const supabaseUrl = env.url
// Names-only explanation shown in the demo banner so a misconfigured deploy is obvious (never values).
export const configProblems = env.problems
export const demoHint = env.problems.length
  ? `Supabase is not configured in this build. ${env.problems.join(' ')} Set the variable(s) in Vercel for the environment this deployment uses (Production / Preview), then redeploy.`
  : ''

// Payments are configured PER FACILITY (owner dashboard → Payments); there is no global Razorpay key.
export const supabaseAnonKey = env.key

// Optional: a hero photo URL you have the right to use (e.g. your own court photo placed in /public).
export const HERO_IMAGE_URL = ''
export const PLATFORM_NAME = 'Smash Booking'
export const LOGO_URL = '/logo.png' // brand mark (public/logo.png)
