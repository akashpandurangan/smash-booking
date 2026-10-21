// Google Maps link validation + directions. The same rules are enforced by the database (_valid_maps_url),
// so a link that passes here is accepted there and vice versa. Owners paste a link; we never fetch it.

const OK = [
  /^https:\/\/(www\.)?google\.[a-z.]{2,10}\/maps([/?#].*)?$/i,
  /^https:\/\/maps\.google\.[a-z.]{2,10}(\/.*)?$/i,
  /^https:\/\/maps\.app\.goo\.gl\/[a-z0-9_-]+([/?#].*)?$/i,
  /^https:\/\/goo\.gl\/maps\/[a-z0-9_-]+([/?#].*)?$/i,
]

/** Empty is fine (the link is optional). Anything else must be an https Google Maps link. */
export function isValidMapsUrl(url) {
  const u = String(url ?? '').trim()
  if (!u) return true
  return u.length <= 500 && !/\s/.test(u) && OK.some((re) => re.test(u))
}

/** "Open in Google Maps" target: the owner's link, else coordinates, else an address search. null if nothing to go on. */
export function directionsUrl({ mapsUrl, latitude, longitude, address, locality, city }) {
  if (mapsUrl && isValidMapsUrl(mapsUrl)) return mapsUrl
  if (latitude != null && longitude != null && latitude !== '' && longitude !== '') {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${latitude},${longitude}`)}`
  }
  const q = [address, locality, city].filter(Boolean).join(', ')
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}

/** Latitude / longitude entered by hand: both or neither, in range. Returns an error string or ''. */
export function checkCoordinates(lat, lng) {
  const a = String(lat ?? '').trim()
  const b = String(lng ?? '').trim()
  if (!a && !b) return ''
  if (!a || !b) return 'Enter both latitude and longitude, or leave both empty.'
  const x = Number(a)
  const y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 90 || Math.abs(y) > 180) return 'Latitude must be between -90 and 90 and longitude between -180 and 180.'
  return ''
}

/** Haversine distance in km (used only by the demo backend; the real one computes it in SQL). */
export function distanceKm(lat1, lng1, lat2, lng2) {
  const r = (d) => (d * Math.PI) / 180
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2
  return Math.round(6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10
}
