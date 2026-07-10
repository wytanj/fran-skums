import { requireApiKey } from '../../../utils/apiAuth'
import { listInternalPos } from '../../../utils/internalPo'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const list = await listInternalPos(auth.workspaceId, {
    status: typeof query.status === 'string' ? query.status : undefined,
    limit: Number(query.limit) || 50,
  })
  return { purchase_orders: list }
})
