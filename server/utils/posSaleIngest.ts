import { commitInventoryForPosSale } from '../fran/pricingInventory'

export async function createPosSaleFromBody(event: any, body: any) {
  const ctx = await requireApiKey(event, 'pos:write')
  const client = getAdminClient()

  if (!body.receipt_number) {
    throw createError({ statusCode: 400, statusMessage: 'receipt_number is required' })
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'items must be a non-empty array' })
  }

  if (body.items.some((item: any) => !item.display_name || item.quantity === undefined || item.unit_price === undefined || item.line_total === undefined)) {
    throw createError({ statusCode: 400, statusMessage: 'each item requires display_name, quantity, unit_price, and line_total' })
  }

  if (body.idempotency_key) {
    const { data: existingSale, error: existingSaleError } = await client
      .from('pos_sales')
      .select('*')
      .eq('workspace_id', ctx.workspaceId)
      .eq('idempotency_key', body.idempotency_key)
      .maybeSingle()

    if (existingSaleError) throw createError({ statusCode: 500, statusMessage: existingSaleError.message })
    if (existingSale) {
      const [{ data: existingItems }, { data: existingPayments }] = await Promise.all([
        client.from('pos_sale_items').select('*').eq('sale_id', existingSale.id).order('line_number'),
        client.from('pos_sale_payments').select('*').eq('sale_id', existingSale.id).order('created_at'),
      ])

      return {
        data: {
          sale: existingSale,
          items: existingItems || [],
          payments: existingPayments || [],
        },
        duplicate: true,
      }
    }
  }

  const saleInput = {
    workspace_id: ctx.workspaceId,
    location_id: body.location_id || null,
    register_id: body.register_id || null,
    register_session_id: body.register_session_id || null,
    receipt_number: body.receipt_number,
    sale_type: body.sale_type || 'sale',
    status: body.status || 'completed',
    customer_ref: body.customer_ref || null,
    currency: body.currency || 'USD',
    subtotal: body.subtotal ?? 0,
    discount_total: body.discount_total ?? 0,
    tax_total: body.tax_total ?? 0,
    total: body.total ?? 0,
    source: body.source || 'api',
    idempotency_key: body.idempotency_key || null,
    completed_at: body.completed_at || new Date().toISOString(),
    metadata: body.metadata || {},
  }

  const { data: sale, error: saleError } = await client
    .from('pos_sales')
    .insert(saleInput)
    .select()
    .single()

  if (saleError) {
    throw createError({ statusCode: 500, statusMessage: saleError.message })
  }

  const items = body.items.map((item: any, index: number) => ({
    workspace_id: ctx.workspaceId,
    sale_id: sale.id,
    line_number: item.line_number ?? index + 1,
    product_identity_id: item.product_identity_id || null,
    trade_unit_id: item.trade_unit_id || null,
    listing_id: item.listing_id || null,
    channel_id: item.channel_id || null,
    sku_assignment_id: item.sku_assignment_id || null,
    identifier_id: item.identifier_id || null,
    product_id: item.product_id || null,
    variant_id: item.variant_id || null,
    batch_id: item.batch_id || null,
    display_name: item.display_name,
    scanned_value: item.scanned_value || null,
    quantity: item.quantity,
    unit_price: item.unit_price,
    list_price: item.list_price ?? null,
    discount_amount: item.discount_amount ?? 0,
    tax_amount: item.tax_amount ?? 0,
    line_total: item.line_total,
    line_type: item.line_type || 'sale',
    reason_code: item.reason_code || null,
    metadata: item.metadata || {},
  }))

  const { data: saleItems, error: itemError } = await client
    .from('pos_sale_items')
    .insert(items)
    .select()

  if (itemError) {
    throw createError({ statusCode: 500, statusMessage: itemError.message })
  }

  const payments = Array.isArray(body.payments) ? body.payments : []
  let salePayments: any[] = []

  if (payments.length > 0) {
    const paymentRows = payments.map((payment: any) => ({
      workspace_id: ctx.workspaceId,
      sale_id: sale.id,
      payment_method: payment.payment_method || payment.mode || 'unknown',
      payment_ref: payment.payment_ref || null,
      amount: payment.amount,
      currency: payment.currency || sale.currency,
      status: payment.status || 'captured',
      metadata: payment.metadata || {},
    }))

    const { data, error } = await client
      .from('pos_sale_payments')
      .insert(paymentRows)
      .select()

    if (error) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }

    salePayments = data || []
  }

  const inventoryCommit = await commitInventoryForPosSale(client, ctx.workspaceId, sale, saleItems || [], body)
  if (inventoryCommit.status === 'applied') {
    sale.metadata = {
      ...(sale.metadata || {}),
      inventory_commit: inventoryCommit,
    }
    await client
      .from('pos_sales')
      .update({ metadata: sale.metadata })
      .eq('id', sale.id)
      .eq('workspace_id', ctx.workspaceId)
  }

  const isReturn = sale.sale_type === 'return' || (saleItems || []).some((item: any) => item.line_type === 'return')
  const eventType = isReturn ? 'pos_return.completed' : 'pos_sale.completed'
  await client.from('domain_events').insert({
    workspace_id: ctx.workspaceId,
    event_type: eventType,
    source_type: 'app',
    source_app_key: 'pos',
    aggregate_type: 'pos_sale',
    aggregate_id: sale.id,
    idempotency_key: saleInput.idempotency_key ? `${saleInput.idempotency_key}:domain_event` : `pos-sale:${sale.id}:domain_event`,
    payload: {
      sale,
      items: saleItems || [],
      payments: salePayments,
      inventory_commit: inventoryCommit,
    },
    metadata: {
      receipt_number: sale.receipt_number,
      sale_type: sale.sale_type,
    },
  })

  setResponseStatus(event, 201)
  return { data: { sale, items: saleItems || [], payments: salePayments } }
}
