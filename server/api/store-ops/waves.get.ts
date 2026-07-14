import { listUpcomingWaveDates, ensureWave } from '../../utils/storeReplenishment'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const workspaceId = String(query.workspace_id || '').trim()
  if (!workspaceId) {
    throw createError({ statusCode: 400, statusMessage: 'workspace_id is required' })
  }

  const client = getServiceClient()
  await requireScope(event, 'store_ops:read', { workspaceId, client, accessLevel: 'member' })

  const ensure = query.ensure === 'true' || query.ensure === '1'
  const upcoming = await listUpcomingWaveDates(client, workspaceId, Number(query.count) || 6)

  if (ensure) {
    for (const row of upcoming.slice(0, 4)) {
      await ensureWave(client, workspaceId, row.wave_date)
    }
  }

  const { data: waves, error } = await client
    .from('store_replenishment_waves')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('wave_date', { ascending: true })
    .limit(20)

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return {
    upcoming,
    waves: waves || [],
    cadence_note: 'Default wave weekdays are Monday (1) and Thursday (4); override via store_ops_settings',
  }
})
