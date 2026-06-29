export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:write')
  const client = getAdminClient()
  const id = getRouterParam(event, 'id')
  const body = await readBody(event)

  const sku = String(body.sku || '').trim()
  if (!sku) {
    throw createError({ statusCode: 400, statusMessage: 'sku is required' })
  }

  const scopeType = body.scope_type || 'workspace'
  const scopeId = body.scope_id || null

  const { data: tradeUnit, error: tradeUnitError } = await client
    .from('trade_units')
    .select('*')
    .eq('id', id!)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (tradeUnitError || !tradeUnit) {
    throw createError({ statusCode: 404, statusMessage: 'Trade unit not found' })
  }

  if (body.is_primary === true) {
    let clearPrimary = client
      .from('sku_assignments')
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq('workspace_id', ctx.workspaceId)
      .eq('trade_unit_id', id!)
      .eq('scope_type', scopeType)
      .eq('is_primary', true)
      .eq('is_active', true)

    clearPrimary = scopeId
      ? clearPrimary.eq('scope_id', scopeId)
      : clearPrimary.is('scope_id', null)

    const { error } = await clearPrimary
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  }

  const { data, error } = await client
    .from('sku_assignments')
    .insert({
      workspace_id: ctx.workspaceId,
      sku,
      scope_type: scopeType,
      scope_id: scopeId,
      scope_label: body.scope_label || null,
      product_identity_id: tradeUnit.product_identity_id,
      trade_unit_id: tradeUnit.id,
      product_id: tradeUnit.product_id,
      variant_id: tradeUnit.variant_id,
      assignment_kind: body.assignment_kind || 'internal',
      is_primary: body.is_primary === true,
      metadata: body.metadata || {},
    })
    .select()
    .single()

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  setResponseStatus(event, 201)
  return { data }
})
