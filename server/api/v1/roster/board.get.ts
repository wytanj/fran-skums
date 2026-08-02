import { requireApiKey } from '../../../utils/apiAuth'
import { getBoard } from '../../../utils/roster'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'roster:read')
  const query = getQuery(event)
  const board = await getBoard(auth.workspaceId, {
    date: typeof query.date === 'string' ? query.date : undefined,
    timezone: typeof query.timezone === 'string' ? query.timezone : 'Asia/Singapore',
  })
  return { board }
})
