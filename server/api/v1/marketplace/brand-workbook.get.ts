/**
 * Recipe **full** — multi-sheet Excel workbook of the Mall harvest.
 * One sheet per brand_key + leading `_index`.
 *
 * GET /api/v1/marketplace/brand-workbook
 *   ?recipe=full | full_sales
 *   &min_sold=0
 *   &brand_keys=biodance,cosrx
 *   &max_brands=120
 *   &meta=1   → JSON only (no file body)
 *
 * Product sheets include **price** (SGD) when any snapshot has it (merged onto
 * the latest/highest-sold row). full_sales (MH-14): sales-sort ranks; sales_rank
 * ≠ monthly units. sold_* remains lifetime.
 *
 * Scope: intel:read
 *
 * Download (PowerShell example):
 *   $h = @{ Authorization = "Bearer $env:SKUMS_API_KEY" }
 *   Invoke-WebRequest "https://fran-skums.vercel.app/api/v1/marketplace/brand-workbook?recipe=full" `
 *     -Headers $h -OutFile mall-harvest-full.xlsx
 */
import { requireApiKey } from '../../../utils/apiAuth'
import { getServiceClient } from '../../../utils/supabase'
import { buildBrandWorkbook } from '../../../../marketplace/exportBrandWorkbook.mjs'

export default defineEventHandler(async (event) => {
  const auth = await requireApiKey(event, 'intel:read')
  const query = getQuery(event)
  const db = getServiceClient()

  const brand_keys =
    typeof query.brand_keys === 'string'
      ? query.brand_keys
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : undefined

  try {
    const built = await buildBrandWorkbook(db, auth.workspaceId, {
      recipe:
        typeof query.recipe === 'string' ? String(query.recipe).toLowerCase() : 'full',
      brand_key:
        typeof query.brand_key === 'string' ? query.brand_key.toLowerCase().trim() : undefined,
      brand_keys,
      min_sold:
        query.min_sold != null && query.min_sold !== '' ? Number(query.min_sold) : undefined,
      shop_username:
        typeof query.shop_username === 'string' ? query.shop_username.trim() : undefined,
      max_brands: query.max_brands != null ? Number(query.max_brands) : undefined,
      since: typeof query.since === 'string' ? query.since : undefined,
      until: typeof query.until === 'string' ? query.until : undefined,
    })

    if (query.meta === '1' || query.meta === 'true') {
      return {
        recipe: built.recipe,
        filename: built.filename,
        sheet_count: built.sheet_count,
        row_count: built.row_count,
        brands: built.brands,
        generated_at: built.generated_at,
        note: built.note,
        download_path: '/api/v1/marketplace/brand-workbook?recipe=full',
      }
    }

    setHeader(event, 'Content-Type', built.content_type)
    setHeader(
      event,
      'Content-Disposition',
      `attachment; filename="${built.filename}"`,
    )
    setHeader(event, 'X-Sheet-Count', String(built.sheet_count))
    setHeader(event, 'X-Row-Count', String(built.row_count))
    return built.buffer
  } catch (e: any) {
    throw createError({
      statusCode: 400,
      statusMessage: e?.message || String(e),
    })
  }
})
