import { requireApiKey } from '../../../utils/apiAuth'
import { listEmployees } from '../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'roster:read')
  const query = getQuery(event)
  const employees = await listEmployees(auth.workspaceId, {
    q: typeof query.q === 'string' ? query.q : undefined,
    source_provider: typeof query.source_provider === 'string' ? query.source_provider : undefined,
    employment_status:
      typeof query.employment_status === 'string' ? query.employment_status : undefined,
    limit: Number(query.limit) || 100,
  })
  return { employees }
})
