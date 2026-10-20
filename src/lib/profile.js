// Facility profile (about / location / amenities) form helpers shared by the setup wizard and Settings.
import { checkCoordinates, isValidMapsUrl } from './maps.js'

export const emptyProfile = () => ({ description: '', locality: '', postalCode: '', mapsUrl: '', latitude: '', longitude: '', amenities: [], coverImageUrl: '' })

/** Form state from a stored facility. */
export const profileFrom = (s) => ({
  description: s.description || '', locality: s.locality || '', postalCode: s.postalCode || '', mapsUrl: s.mapsUrl || '',
  latitude: s.latitude ?? '', longitude: s.longitude ?? '', amenities: s.amenities || [], coverImageUrl: s.coverImageUrl || '',
})

/** Same rules the database enforces, so the owner sees the problem next to the field. Returns { field: message }. */
export function validateProfile(v) {
  const e = {}
  if ((v.description || '').length > 2000) e.description = 'Keep the description under 2,000 characters.'
  if ((v.locality || '').length > 80) e.locality = 'That’s too long (80 characters at most).'
  if (String(v.postalCode || '').trim() && !/^[1-9][0-9]{5}$/.test(String(v.postalCode).trim())) e.postalCode = 'Enter a valid 6-digit PIN code.'
  if (!isValidMapsUrl(v.mapsUrl)) e.mapsUrl = 'That isn’t a Google Maps link. In Google Maps tap Share, then paste the https://maps.app.goo.gl/… link.'
  const c = checkCoordinates(v.latitude, v.longitude)
  if (c) e.latitude = c
  return e
}

/** Payload fields for create/update (empty strings clear a value). */
export const profilePayload = (v) => ({
  description: (v.description || '').trim(), locality: (v.locality || '').trim(), postalCode: String(v.postalCode || '').trim(),
  mapsUrl: (v.mapsUrl || '').trim(), latitude: String(v.latitude ?? '').trim(), longitude: String(v.longitude ?? '').trim(),
  amenities: v.amenities || [], coverImageUrl: (v.coverImageUrl || '').trim(),
})
