export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:write')
  const client = getAdminClient()
  const body = await readBody(event)

  const sourceType = body.source_type || 'csv'
  const allowedSourceTypes = new Set(['csv', 'tsv', 'xlsx', 'json', 'api', 'supplier_feed', 'marketplace_export'])
  if (!allowedSourceTypes.has(sourceType)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid source_type' })
  }

  const { data, error } = await client
    .from('import_jobs')
    .insert({
      workspace_id: ctx.workspaceId,
      source_type: sourceType,
      source_name: body.source_name || null,
      file_name: body.file_name || null,
      file_size_bytes: body.file_size_bytes || null,
      target_schema_id: body.target_schema_id || null,
      status: body.status || 'draft',
      column_mapping: body.column_mapping || {},
      import_options: body.import_options || {},
      mapping_source: body.mapping_source || 'manual',
      inferred_column_mapping: body.inferred_column_mapping || {},
      normalization_model: body.normalization_model || null,
      review_status: body.review_status || 'pending',
    })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return { data }
})
