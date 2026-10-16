// The in-progress selection (date / start / end / courts) survives login, including the
// round-trip through an email-verification link (which may open in a new tab).
// Not sensitive (no personal data), so localStorage with a short expiry is fine.
const KEY = 'booking-draft-v2'
const TTL_MS = 2 * 60 * 60 * 1000

export function saveDraft(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...d, savedAt: Date.now() }))
  } catch {
    /* ignore */
  }
}
export function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!d || Date.now() - d.savedAt > TTL_MS) return null
    return d
  } catch {
    return null
  }
}
export function clearDraft() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
