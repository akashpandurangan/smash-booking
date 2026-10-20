import { checkCoordinates, directionsUrl, distanceKm, isValidMapsUrl } from '../../src/lib/maps.js'
import { validateProfile, profilePayload, profileFrom } from '../../src/lib/profile.js'
import { courtHourlyPrice, courtSlotPrice, hourlyRange, orderTotal } from '../../src/lib/pricing.js'
import { AMENITIES } from '../../src/lib/amenities.js'

let fails = 0
const eq = (a, b, m) => { const ok = JSON.stringify(a) === JSON.stringify(b); console.log(ok ? '  ✓' : '  ✗ FAIL', m, ok ? '' : `→ got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); if (!ok) fails++ }

console.log('Google Maps links')
for (const u of ['https://maps.app.goo.gl/AbC123xyz', 'https://www.google.com/maps/place/Smash+Arena/@18.5,73.7,17z', 'https://google.com/maps?q=18.5,73.7', 'https://maps.google.com/?q=Smash+Arena', 'https://goo.gl/maps/AbCd123', 'https://www.google.co.in/maps/place/X', '']) {
  eq(isValidMapsUrl(u), true, `accepted: ${u || '(empty = optional)'}`)
}
for (const u of ['http://maps.google.com/?q=1', 'https://evil.example.com/maps', 'https://google.com.evil.io/maps/x', 'javascript:alert(1)', 'https://maps.app.goo.gl/has space', 'https://www.google.com/search?q=maps', 'maps.google.com', 'https://maps.app.goo.gl/' + 'a'.repeat(600)]) {
  eq(isValidMapsUrl(u), false, `rejected: ${u.slice(0, 60)}`)
}

console.log('Directions')
eq(directionsUrl({ mapsUrl: 'https://maps.app.goo.gl/AbC', latitude: 1, longitude: 2 }), 'https://maps.app.goo.gl/AbC', 'the owner’s Maps link wins')
eq(directionsUrl({ mapsUrl: 'https://evil.example.com', latitude: 18.5, longitude: 73.7 }), 'https://www.google.com/maps/dir/?api=1&destination=18.5%2C73.7', 'an invalid stored link is ignored → coordinates')
eq(directionsUrl({ address: '1 Main Rd', locality: 'Baner', city: 'Pune' }), 'https://www.google.com/maps/search/?api=1&query=1%20Main%20Rd%2C%20Baner%2C%20Pune', 'no link / coordinates → address search')
eq(directionsUrl({}), null, 'nothing to go on → no directions link')

console.log('Coordinates + distance')
eq([checkCoordinates('', ''), checkCoordinates('18.5', '73.7')], ['', ''], 'both empty / both valid is fine')
eq(checkCoordinates('18.5', '') !== '' && checkCoordinates('95', '10') !== '' && checkCoordinates('x', 'y') !== '', true, 'one missing / out of range / not numbers are errors')
const d = distanceKm(18.5204, 73.8567, 19.076, 72.8777) // Pune → Mumbai ≈ 120 km straight line
eq(d > 110 && d < 130, true, `Pune → Mumbai ≈ ${d} km`)
eq(distanceKm(10, 10, 10, 10), 0, 'same point = 0 km')

console.log('Profile validation (same rules as the database)')
const ok = { description: 'x', locality: 'Baner', postalCode: '411045', mapsUrl: 'https://maps.app.goo.gl/AbC', latitude: '18.5', longitude: '73.7', amenities: [], coverImageUrl: '' }
eq(validateProfile(ok), {}, 'a complete valid profile has no errors')
eq(Object.keys(validateProfile({ ...ok, postalCode: '12345' })), ['postalCode'], 'bad PIN code')
eq(Object.keys(validateProfile({ ...ok, mapsUrl: 'https://evil.example.com' })), ['mapsUrl'], 'bad Maps link')
eq(Object.keys(validateProfile({ ...ok, latitude: '18.5', longitude: '' })), ['latitude'], 'half coordinates')
eq(Object.keys(validateProfile({ ...ok, description: 'x'.repeat(2001) })), ['description'], 'description too long')
eq(Object.keys(validateProfile({ ...ok, postalCode: '', mapsUrl: '', latitude: '', longitude: '' })), [], 'all optional fields may be empty')
eq(profilePayload({ ...ok, description: '  hi  ', latitude: 18.5 }).description, 'hi', 'payload trims text')
eq(profileFrom({ latitude: null, amenities: undefined }).latitude, '', 'null coordinates become empty inputs')
eq(AMENITIES.length, 12, 'amenities come from a fixed list')

console.log('Pricing (display side; the database computes the real total)')
const settings = { pricePerSlot: 150 } // ₹300/hour
const A = { id: 'a', isActive: true, pricePerHour: 400 }
const B = { id: 'b', isActive: true, pricePerHour: null }
const C = { id: 'c', isActive: false, pricePerHour: 100 }
eq([courtHourlyPrice(A, settings), courtHourlyPrice(B, settings)], [400, 300], 'court price overrides, else the facility price')
eq([courtSlotPrice(A, settings), courtSlotPrice(B, settings)], [200, 150], 'per 30-minute slot is half the hourly price')
eq(orderTotal([A, B, C], ['a', 'b'], settings, 2), 700, '1 hour on courts A + B = 400 + 300')
eq(orderTotal([A, B], ['a'], settings, 4), 800, '2 hours on court A = 800')
eq(hourlyRange([A, B, C], settings), { min: 300, max: 400, varies: true }, 'range ignores hidden courts')
eq(hourlyRange([B], settings), { min: 300, max: 300, varies: false }, 'single price → does not vary')
eq(hourlyRange([], settings).min, 300, 'no courts → facility price')

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL MARKETPLACE CHECKS PASSED')
process.exit(fails ? 1 : 0)
