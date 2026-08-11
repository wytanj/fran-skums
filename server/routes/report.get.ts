/**
 * GET /report — self-hosted K-Beauty assortment advisory (static HTML).
 *
 * The page is generated from docs/KBEAUTY_ASSORTMENT_ADVISORY.md and shipped
 * as a Nitro server asset so the link works on the Vercel deployment without
 * any client-side app shell or auth. Raw markdown: /report.md (public/).
 * Unlisted but unauthenticated — the URL itself is the share mechanism.
 */
export default defineEventHandler(async (event) => {
  const html = await useStorage('assets:server').getItem('report.html')
  if (!html) {
    setResponseStatus(event, 404)
    return 'report asset missing'
  }
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return typeof html === 'string' ? html : Buffer.from(html as Uint8Array).toString('utf8')
})
