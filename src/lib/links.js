// Pure link logic (no browser globals) so it can be unit-tested.
//
// kind:
//   'subdomain' https://<slug>.<root>      only once wildcard DNS + Vercel are configured (VITE_WILDCARD_DOMAIN_READY)
//   'public'    https://<this site>/book/<slug>   works on any deployed domain, e.g. *.vercel.app
//   'local'     http://localhost:5173/book/<slug> only on the developer's own computer — never shareable
//   'demo'      deployed demo mode: the facility exists only in this browser's storage — never shareable

export const isLocalHostname = (h) => {
  const host = String(h || '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
    || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
}

export function bookingLinkFor(slug, { origin, hostname, demo = false, wildcardReady = false, rootDomain = 'smashbooking.com' }) {
  const here = `${origin}/book/${slug}`
  const local = isLocalHostname(hostname)
  if (local) return { url: here, previewUrl: here, kind: 'local', shareable: false }
  if (demo) return { url: here, previewUrl: here, kind: 'demo', shareable: false }
  if (wildcardReady) return { url: `https://${slug}.${rootDomain}`, previewUrl: here, kind: 'subdomain', shareable: true }
  return { url: here, previewUrl: here, kind: 'public', shareable: true }
}

export const LINK_NOTE = {
  local: 'Local test link — it only works on this computer. Deploy the app (Vercel) to get a link you can share.',
  demo: 'Demo mode — this facility exists only in your own browser, so this link can’t be shared.',
}
