import type { SupabaseClient } from '@supabase/supabase-js'
import {
  catalogGet,
  catalogSearch,
  catalogStats,
  catalogHealth,
  catalogSample,
  catalogSearchSummary,
} from '../../core/catalog/index.mjs'
import { getHelpArticleForAgent, listHelpArticles, resolveHelp } from '../../core/help/index.mjs'

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
        name: 'resolve_help',
        description:
          'REQUIRED for navigation/how-to/ops questions (where do I…, how do I…, store ops, receive, Loft, floor adjustments, replenishment). Returns ranked Help Center articles with body_excerpt so you can answer quickly. Paths: /help/{slug}, primary_path. Never invent app routes.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'User question, e.g. "how do I approve a store replenishment request"',
            },
            limit: { type: 'number', description: 'Max articles (default 3, max 10)' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_help_article',
        description:
          'Load the full Help Center article by slug (body_md included). Use after resolve_help when you need complete steps (store ops, Loft, floor ledger, inbound ASN, operator runbook). Prefer this over guessing.',
        parameters: {
          type: 'object',
          properties: {
            slug: {
              type: 'string',
              description: 'Article slug e.g. store-ops-replenishment, operator-runbook, loft-worldsyntech',
            },
          },
          required: ['slug'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_help_articles',
        description: 'List published Help Center articles (titles, summaries, paths). Use when the user wants to browse help topics or filter by category (e.g. operations).',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Optional category filter: products, inventory, actions, operations, integrations, settings, ai, getting-started, general',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_catalog_health',
        description:
          'ONE-SHOT catalog structure (import readiness, missing retail, POS flags, cost spread). Prefer for “best products”, research readiness, or bulk-import questions before multi-step sampling.',
        parameters: {
          type: 'object',
          properties: {
            brand: { type: 'string', description: 'Optional brand filter' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'sample_products',
        description:
          'Return N real catalog products in one call (spread or keyword). Use for “sample 5 products” research — not a best-of ranking.',
        parameters: {
          type: 'object',
          properties: {
            n: { type: 'number', description: 'How many (default 5, max 20)' },
            query: { type: 'string', description: 'Optional keyword' },
            brand: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'active', 'archived'] },
            strategy: { type: 'string', enum: ['spread', 'recent', 'keyword'] },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_products_summary',
        description:
          'Search + total + brand/cost facets in one call (e.g. lipsticks). Prefer over search_products when user wants category research stats.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search text' },
            brand: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'active', 'archived'] },
            limit: { type: 'number' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_catalog_stats',
        description:
          'Catalog census for this workspace: exact total product count, counts by status (draft/active/archived), missing SKU, with EAN, and top brands. ALWAYS call this for "how many products" questions — never invent a total. Prefer get_catalog_health for structure/import questions.',
        parameters: {
          type: 'object',
          properties: {
            brand: { type: 'string', description: 'Optional brand name filter (partial match)' },
            top_brands: { type: 'number', description: 'How many top brands to return (default 12)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_products',
        description:
          'Search the workspace product catalog (supports 10k+ SKUs). Returns paginated matches PLUS exact total matching count. Prefer search_products_summary when user also wants brand/cost facets.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text to search in title, SKU, or exact EAN/UPC/GTIN' },
            status: { type: 'string', enum: ['draft', 'active', 'archived'], description: 'Filter by product status' },
            brand: { type: 'string', description: 'Filter by brand name (partial)' },
            sku: { type: 'string', description: 'Partial SKU match' },
            ean: { type: 'string', description: 'Exact EAN' },
            limit: { type: 'number', description: 'Max rows to return (default 15, max 25)' },
            offset: { type: 'number', description: 'Pagination offset (default 0)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_product',
        description: 'Get full details for a single product by id, SKU, EAN, UPC, or GTIN.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Product UUID' },
            sku: { type: 'string', description: 'Product SKU' },
            ean: { type: 'string' },
            upc: { type: 'string' },
            gtin: { type: 'string' },
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
        name: 'get_actions_queue',
        description:
          'List decision-layer work awaiting humans: draft/pending internal POs and proposed/accepted pipeline candidates. Prefer deep links into /actions. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max items per type (default 10)' },
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

  try {
    switch (name) {
      case 'resolve_help': {
        return await resolveHelp(client, String(args.query || ''), {
          limit: args.limit,
        })
      }

      case 'get_help_article': {
        return await getHelpArticleForAgent(client, String(args.slug || ''), {
          max_body_chars: 12000,
        })
      }

      case 'list_help_articles': {
        const articles = await listHelpArticles(client, {
          category: args.category || null,
        })
        return { articles, help_index_path: '/help', count: articles.length }
      }

      case 'get_catalog_health': {
        return await catalogHealth(client, {
          workspace_id: workspaceId,
          brand: args.brand || null,
        })
      }

      case 'sample_products': {
        return await catalogSample(client, {
          workspace_id: workspaceId,
          n: args.n || args.limit,
          q: args.query || args.q || null,
          brand: args.brand || null,
          status: args.status || null,
          strategy: args.strategy || null,
        })
      }

      case 'search_products_summary': {
        return await catalogSearchSummary(client, {
          workspace_id: workspaceId,
          q: args.query || args.q || null,
          brand: args.brand || null,
          status: args.status || null,
          limit: args.limit,
        })
      }

      case 'get_catalog_stats': {
        return await catalogStats(client, {
          workspace_id: workspaceId,
          brand: args.brand || null,
          top_brands: args.top_brands,
        })
      }

      case 'search_products': {
        return await catalogSearch(client, {
          workspace_id: workspaceId,
          q: args.query || args.q || null,
          status: args.status || null,
          brand: args.brand || null,
          sku: args.sku || null,
          ean: args.ean || null,
          upc: args.upc || null,
          gtin: args.gtin || null,
          limit: args.limit,
          offset: args.offset,
        })
      }

      case 'get_product': {
        return await catalogGet(client, {
          workspace_id: workspaceId,
          id: args.id || null,
          sku: args.sku || null,
          ean: args.ean || null,
          upc: args.upc || null,
          gtin: args.gtin || null,
        })
      }

      case 'get_inventory_summary': {
        const limit = Math.min(args.limit || 20, 50)
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
        const limit = Math.min(args.limit || 20, 50)
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
        const limit = Math.min(args.limit || 10, 25)
        const { data, error } = await client
          .from('v_inventory_summary')
          .select('product_id, product_title, product_sku, total_available, total_on_hand')
          .eq('workspace_id', workspaceId)
          .order('total_on_hand', { ascending: false })
          .limit(limit)
        if (error) return { error: error.message }
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
        const limit = Math.min(args.limit || 10, 30)
        // Prefer audit_events (MCP + UI provenance); fall back to activity_log
        let auditQ = client
          .from('audit_events')
          .select('id, entity_type, entity_id, event_type, source_type, tool_name, created_at, actor_user_id')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (args.entity_type) auditQ = auditQ.eq('entity_type', args.entity_type)
        const { data: audit, error: auditErr } = await auditQ
        if (!auditErr && audit?.length) {
          return { activity: audit, source: 'audit_events' }
        }
        let q = client
          .from('activity_log')
          .select('id, entity_type, entity_id, action, changes, created_at, profile:user_id(full_name)')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (args.entity_type) q = q.eq('entity_type', args.entity_type)
        const { data, error } = await q
        if (error) return { error: error.message }
        return { activity: data || [], source: 'activity_log' }
      }

      case 'get_actions_queue': {
        const limit = Math.min(args.limit || 10, 25)
        const [pos, pipeline] = await Promise.all([
          client
            .from('internal_purchase_orders')
            .select('id, po_number, status, supplier_name, created_at, updated_at')
            .eq('workspace_id', workspaceId)
            .in('status', ['draft', 'pending_approval'])
            .order('updated_at', { ascending: false })
            .limit(limit),
          client
            .from('pipeline_candidates')
            .select('id, kind, status, title, created_at, updated_at')
            .eq('workspace_id', workspaceId)
            .in('status', ['proposed', 'accepted', 'deferred'])
            .order('updated_at', { ascending: false })
            .limit(limit),
        ])
        if (pos.error) return { error: pos.error.message }
        if (pipeline.error) return { error: pipeline.error.message }
        return {
          internal_pos: (pos.data || []).map((p: any) => ({
            ...p,
            deep_link: `/actions/internal-pos/${p.id}`,
          })),
          pipeline_candidates: (pipeline.data || []).map((c: any) => ({
            ...c,
            deep_link: `/actions/pipeline/${c.id}`,
          })),
          note: 'These are decision-layer items. Humans submit/approve in Actions UI. MCP (Cursor etc.) can draft more via safe tools.',
        }
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
  } catch (err: any) {
    return { error: err?.message || String(err) }
  }
}
