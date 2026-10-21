// Remembers (in this browser only) the last facility page a player visited, so the account menu on the
// platform site can link to "My bookings" there. It is a navigation hint only — never trusted for access.
const KEY = 'smash:lastFacility'
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

export const rememberFacility = (slug) => {
  try { if (SLUG.test(slug || '')) localStorage.setItem(KEY, slug) } catch { /* storage unavailable */ }
}
export const lastFacility = () => {
  try {
    const s = localStorage.getItem(KEY)
    return SLUG.test(s || '') ? s : null
  } catch {
    return null
  }
}
