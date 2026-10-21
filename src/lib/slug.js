// Facility name → URL-safe subdomain. The database re-validates everything (format, reserved, unique).

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

// Trailing words that add nothing to a web address:  "Green Shuttle Club" → greenshuttle, "Power Play Courts" → powerplay.
// Only TRAILING words are dropped ("Court Kings Club" keeps "court" → courtkings), and never the last remaining word.
const TRAILING = new Set(['club', 'clubs', 'court', 'courts', 'academy', 'center', 'centre'])
const LEADING = new Set(['the'])

const words = (text) =>
  String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/['’`]/g, '') // "Raj's" → "rajs"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/** "Smash Arena" → "smasharena" · "Green Shuttle Club" → "greenshuttle" · "Power Play Courts" → "powerplay" */
export function slugify(name, max = 30) {
  const w = words(name)
  while (w.length > 1 && LEADING.has(w[0])) w.shift()
  while (w.length > 1 && TRAILING.has(w[w.length - 1])) w.pop()
  return w.join('').slice(0, max)
}

/** The preferred slug first, then sensible alternatives (city, suffixes, numbers). */
export function slugCandidates(name, city) {
  const base = slugify(name)
  if (!base) return []
  const c = slugify(city, 14)
  const hw = words(name)
  while (hw.length > 1 && LEADING.has(hw[0])) hw.shift()
  while (hw.length > 1 && TRAILING.has(hw[hw.length - 1])) hw.pop()
  const hyphenated = hw.join('-').slice(0, 30)
  const list = [
    base,
    c && `${base}-${c}`,
    hyphenated !== base && hyphenated,
    `${base}-badminton`,
    `${base}-courts`,
    c && `${base}${c}`,
    `${base}-club`,
    `${base}-2`,
    `${base}-${new Date().getFullYear()}`,
    `${base}-3`,
  ]
  return [...new Set(list.filter(Boolean).map((s) => s.slice(0, 40)).filter((s) => SLUG_RE.test(s) && !s.includes('--')))].slice(0, 10)
}

export const isValidSlug = (s) => SLUG_RE.test(s) && !s.includes('--')

/** Turn whatever the owner types into a valid slug as they type. */
export const cleanSlugInput = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '').replace(/--+/g, '-').replace(/^-+/, '').slice(0, 40)
