export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:read')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')

  const { data, error } = await client
    .from('v_import_job_summary')
    .select('*')
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (error || !data) {
    throw createError({ statusCode: 404, statusMessage: 'Import job not found' })
  }

  const { data: rows, error: rowsError } = await client
    .from('import_job_rows')
    .select('*')
    .eq('import_job_id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .order('row_number')
    .limit(100)

  if (rowsError) throw createError({ statusCode: 500, statusMessage: rowsError.message })

  // Live progress for large catalog imports (written by UI/worker into import_options.progress)
  const progress = (data as any).import_options?.progress || null
  const complete =
    data.status === 'completed' ||
    data.status === 'failed' ||
    data.status === 'cancelled'

  return {
    data: {
      ...data,
      rows: rows || [],
      progress,
      is_complete: complete,
      completion: {
        status: data.status,
        total_rows: data.total_rows,
        committed_rows: data.committed_rows,
        error_rows: data.error_rows,
        review_status: (data as any).review_status ?? null,
        committed_at: data.committed_at,
        progress,
      },
    },
  }
})
