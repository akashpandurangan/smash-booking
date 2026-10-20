// Public configuration only. NEVER put a Supabase service_role key in a VITE_ variable.
const url = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim() // new-style publishable keys (sb_publishable_…) work the same as the legacy anon key

export const supabaseConfigured = /^https?:\/\//.test(url) && anonKey.length > 20
export const isDemo = !supabaseConfigured
export const supabaseUrl = url

// Payments are configured PER FACILITY (owner dashboard → Payments); there is no global Razorpay key.
export const supabaseAnonKey = anonKey

// Optional: a hero photo URL you have the right to use (e.g. your own court photo placed in /public).
export const HERO_IMAGE_URL = ''
export const PLATFORM_NAME = 'Smash Booking'
export const LOGO_URL = '/logo.png' // brand mark (public/logo.png)
