import { requireApiKey } from '../../../utils/apiAuth'
import { upsertShift } from '../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'roster:write')
  const body = await readBody(event)
  try {
    const shift = await upsertShift(auth.workspaceId, body || {})
    setResponseStatus(event, body?.id ? 200 : 201)
    return { shift }
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: err?.message?.slice(0, 300) || 'Failed to upsert shift',
    })
  }
})
