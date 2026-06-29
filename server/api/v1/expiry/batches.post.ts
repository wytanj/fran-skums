/**
 * Create a batch and its items in one call.
 * Body: { batch_code, received_at?, notes?, source?, items: [{ sku, quantity, expiry_month, expiry_year, expiry_day?, unit_cost? }] }
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'products:write')
  const client = getAdminClient()
  const body = await readBody(event)

  if (!body.batch_code) {
    throw createError({ statusCode: 400, statusMessage: 'batch_code is required' })
  }

  const { data: batch, error: batchErr } = await client
    .from('expiry_batches')
    .insert({
      workspace_id: ctx.workspaceId,
      batch_code: body.batch_code,
      received_at: body.received_at || new Date().toISOString().slice(0, 10),
      notes: body.notes || null,
      source: body.source || 'api',
      source_ref: body.source_ref || null,
    })
    .select()
    .single()

  if (batchErr) throw createError({ statusCode: 500, statusMessage: batchErr.message })

  let itemsCreated = 0
  const errors: any[] = []

  if (Array.isArray(body.items) && body.items.length > 0) {
    const rows = body.items.map((item: any, i: number) => {
      if (!item.sku || !item.expiry_month || !item.expiry_year) {
        errors.push({ index: i, error: 'sku, expiry_month, expiry_year required' })
        return null
      }
      return {
        batch_id: batch.id,
        workspace_id: ctx.workspaceId,
        raw_sku: item.sku,
        quantity: item.quantity || 1,
        remaining_qty: item.quantity || 1,
        expiry_year: item.expiry_year,
        expiry_month: item.expiry_month,
        expiry_day: item.expiry_day || null,
        unit_cost: item.unit_cost || null,
        notes: item.notes || null,
      }
    }).filter(Boolean)

    if (rows.length > 0) {
      const { data: inserted, error: itemErr } = await client
        .from('expiry_items')
        .insert(rows)
        .select()

      if (itemErr) {
        errors.push({ error: itemErr.message })
      } else {
        itemsCreated = inserted?.length || 0
      }
    }
  }

  setResponseStatus(event, 201)
  return {
    data: batch,
    items_created: itemsCreated,
    errors: errors.length > 0 ? errors : undefined,
  }
})
