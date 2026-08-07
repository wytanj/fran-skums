/**
 * Summarise an iHerb structure probe.
 * POST /api/v1/marketplace/iherb/probe  { slug, raw }
 *
 * The extension observes in the page — the only place iHerb markup is reachable,
 * since every non-browser request 403s — and this turns those raw observations
 * into a verdict. Summarising server-side keeps one implementation of the
 * judgement; the extension carries only the DOM-facing selectors.
 *
 * Stores nothing yet, deliberately. Committing a schema before the first probe
 * would be guessing at the shape of the data it exists to describe.
 *
 * @see marketplace/iherb/probeSpec.mjs
 * @see docs/IHERB_COLLECT_DESIGN.md
 */
import { summarizeProbe } from '../../../../../marketplace/iherb/probeSpec.mjs'

export default defineEventHandler(async (event) => {
  // intel:read, not write — this reads a page and returns an opinion.
  await requireScope(event, 'intel:read')

  const body = (await readBody(event).catch(() => ({}))) as Record<string, any>
  const raw = body?.raw
  if (!raw || typeof raw !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'raw observations required' })
  }

  const report = summarizeProbe(raw)

  return {
    ok: true,
    slug: body?.slug ? String(body.slug).toLowerCase() : null,
    report,
    // Absence is the finding, so say it out loud rather than leaving it to be
    // noticed in a field list.
    note: report.missing.length
      ? `Not published on this page: ${report.missing.join(', ')}.`
      : 'Every probed field resolved.',
  }
})
