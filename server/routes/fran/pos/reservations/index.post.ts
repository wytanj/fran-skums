import { createReservationFromBody } from '../../../../fran/pricingInventory'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return createReservationFromBody(event, body || {})
})
