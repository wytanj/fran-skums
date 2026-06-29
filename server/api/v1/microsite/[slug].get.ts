/**
 * Public endpoint — no auth required.
 * Returns expiry data for a public microsite.
 */
export default defineEventHandler(async (event) => {
  const client = getAdminClient()
  const slug = getRouterParam(event, 'slug')

  const { data: site, error: siteErr } = await client
    .from('expiry_microsites')
    .select('*')
    .eq('slug', slug!)
    .eq('is_active', true)
    .single()

  if (siteErr || !site) {
    throw createError({ statusCode: 404, statusMessage: 'Microsite not found or inactive' })
  }

  let q = client
    .from('expiry_items')
    .select('id, raw_sku, product_id, quantity, remaining_qty, expiry_year, expiry_month, expiry_day, status, batch:batch_id(batch_code), product:product_id(title, sku)')
    .eq('workspace_id', site.workspace_id)
    .eq('status', 'in_stock')
    .gt('remaining_qty', 0)
    .order('expiry_year', { ascending: true })
    .order('expiry_month', { ascending: true })

  if (site.product_filter && site.product_filter.length > 0) {
    q = q.in('product_id', site.product_filter)
  }

  const { data: items } = await q

  return {
    site: {
      title: site.title,
      description: site.description,
      logo_url: site.logo_url,
      accent_color: site.accent_color,
      footer_text: site.footer_text,
      show_product_name: site.show_product_name,
      show_batch_code: site.show_batch_code,
      show_sku: site.show_sku,
      show_quantity: site.show_quantity,
      show_days_remaining: site.show_days_remaining,
    },
    items: (items || []).map((item: any) => ({
      id: item.id,
      product_name: item.product?.title || null,
      sku: item.raw_sku,
      batch_code: item.batch?.batch_code || null,
      quantity: item.remaining_qty,
      expiry_year: item.expiry_year,
      expiry_month: item.expiry_month,
      expiry_day: item.expiry_day,
    })),
  }
})
