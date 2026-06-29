import { normalizeFranPosSaleBody } from '../../../fran/pos'
import { createPosSaleFromBody } from '../../../utils/posSaleIngest'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return createPosSaleFromBody(event, normalizeFranPosSaleBody(body))
})
