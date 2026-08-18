/**
 * MCP catalog Q&A (shared core/catalog).
 */
import {
  catalogGet,
  catalogSearch,
  catalogStats,
  catalogHealth,
  catalogSample,
  catalogSearchSummary,
  catalogExportCsv,
  catalogDataOps,
  fetchCatalogMatchPool,
} from '../../../core/catalog/index.mjs'
import {
  importFormatSpec,
  importFormatCsv,
  importFormatXlsxBuffer,
} from '../../../core/import/format.mjs'
import { getDb } from '../context.mjs'

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function searchCatalog(workspaceId, args = {}) {
  return catalogSearch(getDb(), {
    workspace_id: workspaceId,
    q: args.q || args.query || null,
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

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function statsCatalog(workspaceId, args = {}) {
  return catalogStats(getDb(), {
    workspace_id: workspaceId,
    brand: args.brand || null,
    top_brands: args.top_brands,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function getCatalogProduct(workspaceId, args = {}) {
  return catalogGet(getDb(), {
    workspace_id: workspaceId,
    id: args.id || args.product_id || null,
    sku: args.sku || null,
    ean: args.ean || null,
    upc: args.upc || null,
    gtin: args.gtin || null,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function healthCatalog(workspaceId, args = {}) {
  return catalogHealth(getDb(), {
    workspace_id: workspaceId,
    brand: args.brand || null,
    sample_for_cost: args.sample_for_cost,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function sampleCatalog(workspaceId, args = {}) {
  return catalogSample(getDb(), {
    workspace_id: workspaceId,
    n: args.n || args.limit,
    q: args.q || args.query || null,
    brand: args.brand || null,
    status: args.status || null,
    strategy: args.strategy || null,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function searchSummaryCatalog(workspaceId, args = {}) {
  return catalogSearchSummary(getDb(), {
    workspace_id: workspaceId,
    q: args.q || args.query || null,
    brand: args.brand || null,
    status: args.status || null,
    limit: args.limit,
    facet_sample: args.facet_sample,
  })
}

/**
 * @param {string} workspaceId
 * @param {{ query?: string, listing_titles?: string[], limit?: number }} [args]
 */
export async function matchPool(workspaceId, args = {}) {
  return fetchCatalogMatchPool(getDb(), {
    workspace_id: workspaceId,
    query: args.query,
    listing_titles: args.listing_titles,
    limit: args.limit,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function exportCsvCatalog(workspaceId, args = {}) {
  return catalogExportCsv(getDb(), {
    workspace_id: workspaceId,
    q: args.q || args.query || null,
    brand: args.brand || null,
    status: args.status || null,
    sku: args.sku || null,
    limit: args.limit,
    offset: args.offset,
    columns: args.columns || null,
  })
}

/**
 * @param {string} workspaceId
 * @param {Record<string, any>} [args]
 */
export async function dataOpsCatalog(workspaceId, args = {}) {
  return catalogDataOps(getDb(), {
    workspace_id: workspaceId,
    brand: args.brand || null,
    q: args.q || args.query || null,
    seed_suggestions: args.seed_suggestions || args.n,
    marketplace: args.marketplace || null,
    country: args.country || null,
  })
}

/**
 * Exact SKUMS import sheet contract for Claude to reformat supplier files.
 * @param {{ kind?: string, include_xlsx?: boolean }} [args]
 */
export async function importFormatCatalog(args = {}) {
  const kind = args.kind === 'full' ? 'full' : 'planogram'
  const spec = importFormatSpec(kind)
  const out = {
    ...spec,
    csv_template: importFormatCsv(spec),
    agent_hint:
      'Call this first. Rewrite the user’s dirty sheet into these exact headers. Save as reformatted.xlsx. Tell them to upload at /import-export. Do not invent UPC, sku, price, or Korean if missing.',
  }
  if (args.include_xlsx === true) {
    const XLSX = (await import('xlsx')).default
    const buf = importFormatXlsxBuffer(spec, XLSX)
    out.xlsx_base64 = Buffer.from(buf).toString('base64')
    out.xlsx_filename = 'skums-import-format.xlsx'
  }
  return out
}
