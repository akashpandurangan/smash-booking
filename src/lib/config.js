// Public configuration only. NEVER put a Supabase service_role key in a VITE_ variable.
const url = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const supabaseConfigured = /^https?:\/\//.test(url) && anonKey.length > 20
export const isDemo = !supabaseConfigured
export const supabaseUrl = url

// Public Razorpay KEY ID only (rzp_test_… / rzp_live_…). The key SECRET lives in Supabase Edge Function secrets.
const razorpayKeyId = (import.meta.env.VITE_RAZORPAY_KEY_ID || '').trim()
export const razorpayEnabled = supabaseConfigured && /^rzp_(test|live)_/.test(razorpayKeyId)
export const RAZORPAY_KEY_ID = razorpayKeyId
export const supabaseAnonKey = anonKey

// Optional: a hero photo URL you have the right to use (e.g. your own court photo placed in /public).
export const HERO_IMAGE_URL = ''
export const LOGO_URL = '/logo.png' // brand mark (public/logo.png)
