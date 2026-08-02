/**
 * POS-facing day roster board (who is in which zone).
 * GET /api/v1/pos/roster/board?date=YYYY-MM-DD
 * Scope: pos:read (or roster:read)
 */
import { authenticateApiKey, hasApiKeyScope } from '../../../../utils/apiAuth'
import { getBoard } from '../../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await authenticateApiKey(event)
  if (!auth) throw createError({ statusCode: 401, statusMessage: 'API key required' })
  if (!hasApiKeyScope(auth, 'pos:read') && !hasApiKeyScope(auth, 'roster:read')) {
    throw createError({ statusCode: 403, statusMessage: 'pos:read or roster:read required' })
  }

  const query = getQuery(event)
  const board = await getBoard(auth.workspaceId, {
    date: typeof query.date === 'string' ? query.date : undefined,
    timezone: typeof query.timezone === 'string' ? query.timezone : 'Asia/Singapore',
  })
  return { board }
})
