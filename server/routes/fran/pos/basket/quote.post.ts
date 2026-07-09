import { createBasketQuoteFromBody } from '../../../../fran/pricingInventory'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return createBasketQuoteFromBody(event, body || {})
})
