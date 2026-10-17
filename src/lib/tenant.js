import { isDemo } from './config.js'

// Hostname-based tenant resolution. ONE shared app serves every facility.
//
//   smasharena.smashbooking.com   → mode 'host'     slug 'smasharena'   (production)
//   smasharena.localhost:5173     → mode 'host'     slug 'smasharena'   (local dev, no DNS needed)
//   <anything>/f/smasharena/...   → mode 'path'     slug 'smasharena'   (works on the existing
//                                                    *.vercel.app domain and on plain localhost)
//   smashbooking.com / www / app  → mode 'platform'  (marketing site, owner dashboard, platform admin)
//
// The slug is only a LOOKUP KEY. The database resolves it to a facility, decides whether it is live,
// and every booking RPC re-derives the facility server-side — ids are never trusted from the browser.

export const ROOT_DOMAIN = (import.meta.env.VITE_ROOT_DOMAIN || 'smashbooking.com').trim().toLowerCase()
// Set to "true" ONLY after the wildcard domain is added in Vercel and DNS has propagated.
export const WILDCARD_READY = String(import.meta.env.VITE_WILDCARD_DOMAIN_READY || '').toLowerCase() === 'true'

const PLATFORM_LABELS = new Set(['www', 'app'])
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

export function resolveTenant(loc) {
  const host = loc.hostname.toLowerCase()

  for (const base of new Set([ROOT_DOMAIN, 'localhost'])) {
    if (host.endsWith(`.${base}`)) {
      const sub = host.slice(0, -(base.length + 1))
      if (!sub.includes('.') && !PLATFORM_LABELS.has(sub)) {
        return { mode: 'host', slug: SLUG_RE.test(sub) ? sub : '', basename: '' }
      }
      return { mode: 'platform', slug: null, basename: '' }
    }
  }

  const m = loc.pathname.match(/^\/f\/([^/]+)/i)
  if (m) {
    const slug = decodeURIComponent(m[1]).toLowerCase()
    return { mode: 'path', slug: SLUG_RE.test(slug) ? slug : '', basename: `/f/${m[1]}` }
  }
  return { mode: 'platform', slug: null, basename: '' }
}

/** Dev convenience: ?facility=slug jumps to the path form. */
function redirectQueryFallback() {
  const q = new URLSearchParams(window.location.search).get('facility')
  if (q && SLUG_RE.test(q.toLowerCase()) && resolveTenant(window.location).mode === 'platform') {
    window.location.replace(`/f/${q.toLowerCase()}`)
    return true
  }
  return false
}

export const TENANT = typeof window === 'undefined' ? { mode: 'platform', slug: null, basename: '' } : resolveTenant(window.location)
export const REDIRECTING = typeof window !== 'undefined' && redirectQueryFallback()
export const isTenantSite = TENANT.mode !== 'platform'

const origin = () => window.location.origin
const isLocalHost = () => /(^|\.)localhost$/.test(window.location.hostname)

/** Link that works RIGHT NOW (no custom domain needed): /f/<slug> on the current origin. */
export const workingUrl = (slug) => `${origin()}/f/${slug}`
/** The branded subdomain URL (only live once DNS + Vercel are configured). */
export function subdomainUrl(slug) {
  if (isLocalHost()) return `${window.location.protocol}//${slug}.localhost${window.location.port ? `:${window.location.port}` : ''}`
  return `https://${slug}.${ROOT_DOMAIN}`
}
/** The URL we show owners as THE booking link: subdomain once the domain is connected, else the working link. */
export const bookingUrl = (slug) => (!isDemo && (WILDCARD_READY || isLocalHost()) ? subdomainUrl(slug) : workingUrl(slug))

/** URL of a platform page (owner login, dashboard…) from anywhere, including a tenant subdomain. */
export function platformUrl(path = '/') {
  if (TENANT.mode === 'host') {
    if (isLocalHost()) return `${window.location.protocol}//localhost${window.location.port ? `:${window.location.port}` : ''}${path}`
    return `https://${ROOT_DOMAIN}${path}`
  }
  return `${origin()}${path}`
}
