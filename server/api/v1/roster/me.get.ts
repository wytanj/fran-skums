/**
 * Current zone assignment for a staff ref (POS badge).
 * GET /api/v1/roster/me?pos_staff_ref=...&at=
 * Accepts roster:read or pos:read
 */
import { authenticateApiKey, hasApiKeyScope } from '../../../utils/apiAuth'
import { getMyAssignment } from '../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await authenticateApiKey(event)
  if (!auth) throw createError({ statusCode: 401, statusMessage: 'API key required' })
  if (!hasApiKeyScope(auth, 'roster:read') && !hasApiKeyScope(auth, 'pos:read')) {
    throw createError({ statusCode: 403, statusMessage: 'roster:read or pos:read required' })
  }

  const query = getQuery(event)
  const assignment = await getMyAssignment(auth.workspaceId, {
    pos_staff_ref:
      typeof query.pos_staff_ref === 'string'
        ? query.pos_staff_ref
        : typeof query.staff_ref === 'string'
          ? query.staff_ref
          : undefined,
    employee_id: typeof query.employee_id === 'string' ? query.employee_id : undefined,
    external_id: typeof query.external_id === 'string' ? query.external_id : undefined,
    at: typeof query.at === 'string' ? query.at : undefined,
  })
  return { assignment }
})
