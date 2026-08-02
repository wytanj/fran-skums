/**
 * POS-facing current zone for logged-in staff.
 * GET /api/v1/pos/roster/me?pos_staff_ref=... (or staff_ref)
 * Scope: pos:read
 */
import { requireApiKey } from '../../../../utils/apiAuth'
import { getMyAssignment } from '../../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'pos:read')
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
