// Display-side pricing. The database computes the real amount (create_order) from the same rule:
// a court's own hourly price if the owner set one, otherwise the facility's price.

/** Price per 30-minute slot for one court. */
export const courtSlotPrice = (court, settings) =>
  court?.pricePerHour != null ? Math.round((Number(court.pricePerHour) / 2) * 100) / 100 : settings.pricePerSlot

/** Price per hour for one court. */
export const courtHourlyPrice = (court, settings) => (court?.pricePerHour != null ? Number(court.pricePerHour) : settings.pricePerSlot * 2)

/** Total for these courts over `slots` 30-minute slots. */
export const orderTotal = (courts, ids, settings, slots) =>
  courts.filter((c) => ids.includes(c.id)).reduce((sum, c) => sum + courtSlotPrice(c, settings), 0) * slots

/** { min, max, varies } hourly price across the bookable courts (falls back to the facility price with no courts). */
export function hourlyRange(courts, settings) {
  const active = courts.filter((c) => c.isActive)
  const prices = (active.length ? active : [null]).map((c) => courtHourlyPrice(c, settings))
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return { min, max, varies: min !== max }
}
