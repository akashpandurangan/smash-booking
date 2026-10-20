// Single Supabase client for the app (created in api/supabase.js, only when env vars are set).
// Import from here if you need the client directly; do not create a second one.
export { supabase } from './api/supabase.js'
export { supabaseConfigured } from './config.js'
