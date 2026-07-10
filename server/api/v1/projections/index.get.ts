import { requireApiKey } from '../../../utils/apiAuth'
import { listProjections } from '../../../utils/projections'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const projections = await listProjections(auth.workspaceId, {
    source_type: typeof query.source_type === 'string' ? query.source_type : undefined,
    limit: Number(query.limit) || 50,
  })
  return { projections }
})
