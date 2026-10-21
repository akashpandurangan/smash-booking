// Fixed amenity list (the database accepts only these keys, so there is no free-text injection).
export const AMENITIES = [
  { key: 'parking', label: 'Parking' },
  { key: 'restrooms', label: 'Restrooms' },
  { key: 'drinking_water', label: 'Drinking water' },
  { key: 'changing_rooms', label: 'Changing rooms' },
  { key: 'showers', label: 'Showers' },
  { key: 'seating', label: 'Seating area' },
  { key: 'equipment_rental', label: 'Equipment rental' },
  { key: 'coaching', label: 'Coaching' },
  { key: 'cafe', label: 'Café' },
  { key: 'wifi', label: 'Wi-Fi' },
  { key: 'first_aid', label: 'First aid' },
  { key: 'air_conditioned', label: 'Air-conditioned' },
]
export const AMENITY_LABEL = Object.fromEntries(AMENITIES.map((a) => [a.key, a.label]))
