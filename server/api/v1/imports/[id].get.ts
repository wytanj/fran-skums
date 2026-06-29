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

  return { data: { ...data, rows: rows || [] } }
})
