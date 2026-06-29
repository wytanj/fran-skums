import { createPosSaleFromBody } from '../../../utils/posSaleIngest'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return createPosSaleFromBody(event, body)
})
