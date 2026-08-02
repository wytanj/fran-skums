import { requireApiKey } from '../../../utils/apiAuth'
import { listShifts } from '../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'roster:read')
  const query = getQuery(event)
  const shifts = await listShifts(auth.workspaceId, {
    from: typeof query.from === 'string' ? query.from : undefined,
    to: typeof query.to === 'string' ? query.to : undefined,
    employee_id: typeof query.employee_id === 'string' ? query.employee_id : undefined,
    zone_id: typeof query.zone_id === 'string' ? query.zone_id : undefined,
    status: typeof query.status === 'string' ? query.status : undefined,
    limit: Number(query.limit) || 200,
  })
  return { shifts }
})
