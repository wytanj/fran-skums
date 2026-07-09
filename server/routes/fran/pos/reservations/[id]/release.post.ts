import { releaseReservationFromBody } from '../../../../../fran/pricingInventory'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'reservation id is required' })

  return releaseReservationFromBody(event, id)
})
