/**
 * GET /mcp/report.md — download the marketplace analysis report as Markdown.
 * Filename: "August iHerb Shopee Analysis 2026.md".
 * Source of truth: docs/KBEAUTY_ASSORTMENT_ADVISORY.md (copied to server/assets).
 */
export default defineEventHandler(async (event) => {
  const md = await useStorage('assets:server').getItem('report.md')
  if (!md) {
    setResponseStatus(event, 404)
    return 'report markdown missing'
  }
  setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="August iHerb Shopee Analysis 2026.md"')
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return typeof md === 'string' ? md : Buffer.from(md as Uint8Array).toString('utf8')
})
