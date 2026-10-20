import { bookingLinkFor, isLocalHostname } from '../../src/lib/links.js'
let fails = 0
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); console.log(ok ? '  ✓' : '  ✗ FAIL', m, ok ? '' : `→ got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); if (!ok) fails++ }
const L = (o, host, extra = {}) => bookingLinkFor('smasharena', { origin: o, hostname: host, ...extra })

console.log('local development')
eq(L('http://localhost:5173', 'localhost'), { url: 'http://localhost:5173/book/smasharena', previewUrl: 'http://localhost:5173/book/smasharena', kind: 'local', shareable: false }, 'localhost → /book/<slug>, labelled local, not shareable')
eq(L('http://akash.localhost:5173', 'akash.localhost').kind, 'local', '*.localhost is local (never shown as a public subdomain)')
eq(L('http://192.168.1.5:5173', '192.168.1.5').shareable, false, 'LAN address is not shareable')
eq(L('http://localhost:5173', 'localhost', { wildcardReady: true }).kind, 'local', 'wildcard flag does not make localhost public')

console.log('production on the Vercel domain')
const v = L('https://smash-booking-pink.vercel.app', 'smash-booking-pink.vercel.app')
eq([v.url, v.kind, v.shareable], ['https://smash-booking-pink.vercel.app/book/smasharena', 'public', true], 'deployed → https://<vercel domain>/book/<slug>, shareable')
eq(L('https://smash-booking-pink.vercel.app', 'smash-booking-pink.vercel.app', { demo: true }).shareable, false, 'deployed DEMO mode is not shareable')

console.log('branded subdomain only when explicitly ready')
eq(L('https://smashbooking.com', 'smashbooking.com', { wildcardReady: false }).url, 'https://smashbooking.com/book/smasharena', 'wildcard NOT ready → path link, no subdomain claimed')
const w = L('https://smashbooking.com', 'smashbooking.com', { wildcardReady: true })
eq([w.url, w.kind, w.previewUrl], ['https://smasharena.smashbooking.com', 'subdomain', 'https://smashbooking.com/book/smasharena'], 'wildcard ready → subdomain link; preview stays on a path that works')
eq([isLocalHostname('smashbooking.com'), isLocalHostname('172.20.0.1'), isLocalHostname('172.32.0.1')], [false, true, false], 'private ranges detected correctly')
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL LINK CHECKS PASSED')
process.exit(fails ? 1 : 0)
