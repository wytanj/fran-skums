import { commitReservationFromBody } from '../../../../../fran/pricingInventory'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'reservation id is required' })

  const body = await readBody(event)
  return commitReservationFromBody(event, id, body || {})
})
