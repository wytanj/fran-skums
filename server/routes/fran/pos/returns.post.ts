import { normalizeFranPosSaleBody } from '../../../fran/pos'
import { createPosSaleFromBody } from '../../../utils/posSaleIngest'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const normalized = normalizeFranPosSaleBody(body, 'return')
  normalized.items = (normalized.items || []).map((item: any) => ({
    ...item,
    line_type: item.line_type || 'return',
  }))
  return createPosSaleFromBody(event, normalized)
})
