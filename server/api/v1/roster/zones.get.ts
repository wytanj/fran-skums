import { requireApiKey } from '../../../utils/apiAuth'
import { listZones } from '../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'roster:read')
  const query = getQuery(event)
  const zones = await listZones(auth.workspaceId, {
    active_only: query.active_only !== 'false',
  })
  return { zones }
})
