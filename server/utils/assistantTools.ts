import type { SupabaseClient } from '@supabase/supabase-js'

export interface ToolContext {
  client: SupabaseClient
  workspaceId: string
  slackWebhookUrl?: string | null
}

export function buildToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'search_products',
        description: 'Search products in the workspace by title, SKU, status, or brand name. Returns a list of matching products with key fields.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text to search in title or SKU' },
            status: { type: 'string', enum: ['draft', 'active', 'archived'], description: 'Filter by product status' },
            limit: { type: 'number', description: 'Max results to return (default 10, max 50)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_product',
        description: 'Get full details for a single product by its ID or SKU, including variants, images, and schema data.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Product UUID' },
            sku: { type: 'string', description: 'Product SKU' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_inventory_summary',
        description: 'Get inventory summary across all locations — on_hand, reserved, available, in_transit, on_order quantities per product.',
        parameters: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Filter by product title or SKU' },
            limit: { type: 'number', description: 'Max rows (default 20)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_low_stock_alerts',
        description: 'Get products that are at or below their low stock threshold. Returns product name, SKU, available quantity, and threshold.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_expiry_summary',
        description: 'Get expiry tracking summary — total items, expired count, items expiring in 30 and 90 days.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_top_products_by_value',
        description: 'Get the top N products ranked by inventory value (retail_price × available stock).',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of products to return (default 10)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_recent_activity',
        description: 'Get recent activity log entries for the workspace — product edits, imports, inventory changes, etc.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of entries (default 10)' },
            entity_type: { type: 'string', description: 'Filter by entity type (e.g. product, inventory)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_slack_notification',
        description: 'Send a formatted message to the workspace Slack channel (requires Slack webhook configured in Settings → AI Assistant).',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The message to send to Slack (markdown supported)' },
          },
          required: ['message'],
        },
      },
    },
  ]
}

export async function executeTool(name: string, args: any, ctx: ToolContext): Promise<any> {
  const { client, workspaceId, slackWebhookUrl } = ctx

  switch (name) {
    case 'search_products': {
      const limit = Math.min(args.limit || 10, 50)
      let q = client
        .from('products')
        .select('id, title, sku, ean, status, retail_price, stock_quantity, brand:brand_id(name), category:category_id(name)')
        .eq('workspace_id', workspaceId)
        .order('title')
        .limit(limit)
      if (args.query) q = q.or(`title.ilike.%${args.query}%,sku.ilike.%${args.query}%`)
      if (args.status) q = q.eq('status', args.status)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { products: data || [], count: (data || []).length }
    }

    case 'get_product': {
      if (!args.id && !args.sku) return { error: 'Provide either id or sku' }
      let q = client
        .from('products')
        .select('*, brand:brand_id(id,name), category:category_id(id,name), images:product_images(*), variants:product_variants(*)')
        .eq('workspace_id', workspaceId)
      if (args.id) q = q.eq('id', args.id)
      else q = q.eq('sku', args.sku)
      const { data, error } = await q.single()
      if (error) return { error: error.message }
      return { product: data }
    }

    case 'get_inventory_summary': {
      const limit = args.limit || 20
      let q = client
        .from('v_inventory_summary')
        .select('product_id, product_title, product_sku, total_on_hand, total_reserved, total_available, total_in_transit, total_on_order')
        .eq('workspace_id', workspaceId)
        .order('product_title')
        .limit(limit)
      if (args.search) q = q.or(`product_title.ilike.%${args.search}%,product_sku.ilike.%${args.search}%`)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { summary: data || [] }
    }

    case 'get_low_stock_alerts': {
      const limit = args.limit || 20
      const { data, error } = await client
        .from('v_low_stock')
        .select('product_id, product_title, product_sku, total_available, low_stock_threshold')
        .eq('workspace_id', workspaceId)
        .order('total_available')
        .limit(limit)
      if (error) return { error: error.message }
      return { low_stock: data || [], count: (data || []).length }
    }

    case 'get_expiry_summary': {
      const { data, error } = await client.rpc('expiry_summary', { p_workspace_id: workspaceId })
      if (error) return { error: error.message }
      return { summary: data }
    }

    case 'get_top_products_by_value': {
      const limit = args.limit || 10
      const { data, error } = await client
        .from('v_inventory_summary')
        .select('product_id, product_title, product_sku, total_available, total_on_hand')
        .eq('workspace_id', workspaceId)
        .order('total_on_hand', { ascending: false })
        .limit(limit)
      if (error) return { error: error.message }
      // Enrich with price data
      const ids = (data || []).map((r: any) => r.product_id)
      if (ids.length === 0) return { top_products: [] }
      const { data: prices } = await client
        .from('products')
        .select('id, retail_price')
        .in('id', ids)
      const priceMap: Record<string, number> = {}
      ;(prices || []).forEach((p: any) => { priceMap[p.id] = p.retail_price || 0 })
      const enriched = (data || []).map((r: any) => ({
        ...r,
        retail_price: priceMap[r.product_id] || 0,
        inventory_value: (priceMap[r.product_id] || 0) * (r.total_available || 0),
      })).sort((a: any, b: any) => b.inventory_value - a.inventory_value)
      return { top_products: enriched }
    }

    case 'get_recent_activity': {
      const limit = args.limit || 10
      let q = client
        .from('activity_log')
        .select('id, entity_type, entity_id, action, changes, created_at, profile:user_id(full_name)')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (args.entity_type) q = q.eq('entity_type', args.entity_type)
      const { data, error } = await q
      if (error) return { error: error.message }
      return { activity: data || [] }
    }

    case 'send_slack_notification': {
      if (!slackWebhookUrl) {
        return { error: 'No Slack webhook configured. Go to Settings → AI Assistant to add one.' }
      }
      try {
        const res = await $fetch(slackWebhookUrl, {
          method: 'POST',
          body: { text: args.message },
        })
        return { success: true, response: res }
      } catch (err: any) {
        return { error: `Slack delivery failed: ${err?.message || 'Unknown error'}` }
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}
