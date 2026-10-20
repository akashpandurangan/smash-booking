import { inspectSupabaseEnv as i } from '../../src/lib/envcheck.js'
let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗ FAIL', m); if (!c) fails++ }
const URL = 'https://abcdefgh.supabase.co'
const KEY = 'sb_publishable_' + 'x'.repeat(24)
const jwt = (role) => `h.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.s`

ok(i({ url: URL, publishableKey: KEY }).configured, 'URL + publishable key → real mode')
ok(i({ url: URL, anonKey: KEY }).configured, 'legacy ANON key name still works')
ok(i({ url: ` "${URL}/" `, publishableKey: ` '${KEY}' ` }).configured && i({ url: ` "${URL}/" `, publishableKey: KEY }).url === URL, 'quotes / spaces / trailing slash pasted into Vercel are tolerated')
ok(!i({}).configured && i({}).problems.length === 2, 'nothing set → demo, naming both variables')
ok(!i({ url: URL }).configured && /VITE_SUPABASE_PUBLISHABLE_KEY/.test(i({ url: URL }).problems[0]), 'missing key → demo, names the key variable')
ok(!i({ publishableKey: KEY }).configured && /VITE_SUPABASE_URL/.test(i({ publishableKey: KEY }).problems[0]), 'missing URL → demo, names the URL variable')
ok(!i({ url: 'abcdefgh.supabase.co', publishableKey: KEY }).configured, 'URL without https:// → demo')
ok(!i({ url: URL + '/rest/v1', publishableKey: KEY }).configured, 'URL with a path → demo')
ok(!i({ url: URL, publishableKey: 'short' }).configured, 'truncated key → demo')
const sec = i({ url: URL, publishableKey: 'sb_secret_' + 'y'.repeat(30) })
ok(!sec.configured && sec.key === '' && /SECRET/.test(sec.problems.join()), 'sb_secret_ key is refused and never exposed')
ok(!i({ url: URL, anonKey: jwt('service_role') }).configured, 'service_role JWT is refused')
ok(i({ url: URL, anonKey: jwt('anon') }).configured, 'anon JWT accepted')
ok(!JSON.stringify(i({ url: URL, publishableKey: 'sb_secret_' + 'y'.repeat(30) })).includes('yyyy'), 'problem messages never contain the key value')
console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL ENV CHECKS PASSED')
process.exit(fails ? 1 : 0)
