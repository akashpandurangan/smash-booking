// Single entry point. Components import `api` and never care which backend is behind it.
// Supabase env vars present → real backend. Otherwise → clearly-labelled demo mode.
import { isDemo } from '../config.js'
import { demoApi } from './demo.js'
import { supabaseApi } from './supabase.js'

export const api = isDemo ? demoApi : supabaseApi
