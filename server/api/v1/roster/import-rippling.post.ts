import { requireApiKey } from '../../../utils/apiAuth'
import { importRipplingEmployees } from '../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'roster:write')
  const body = await readBody(event)
  const workers = Array.isArray(body?.workers) ? body.workers : Array.isArray(body) ? body : []
  try {
    const result = await importRipplingEmployees(auth.workspaceId, workers)
    return {
      ...result,
      note: 'Rippling-shaped import only — no live Rippling API call.',
    }
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      statusMessage: err?.message?.slice(0, 300) || 'Import failed',
    })
  }
})
