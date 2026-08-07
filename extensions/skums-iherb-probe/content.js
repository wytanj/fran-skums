/**
 * In-page iHerb structure probe. Observes, never extracts.
 *
 * Runs in the warm profile, which is the only place iHerb markup can be seen —
 * every non-browser request 403s. It reports what is present so the parser can
 * be written against real markup and checked-in fixtures, instead of selectors
 * guessed from memory that would fail silently on an empty grid.
 *
 * @see marketplace/iherb/probeSpec.mjs
 * @see docs/IHERB_COLLECT_DESIGN.md
 */
;(() => {
  /** Brand slug from /c/<slug>. On iHerb the URL is the brand — unlike Shopee. */
  function detectCatalogue() {
    const m = location.pathname.match(/^\/c\/([^/?#]+)/i)
    if (!m) return null
    return {
      slug: decodeURIComponent(m[1]).toLowerCase(),
      url: location.href.split('#')[0],
    }
  }

  /** Structured payloads, best first. A payload beats any selector. */
  function findStructuredPayloads() {
    const out = []

    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
    let products = 0
    let breadcrumbs = 0
    const samples = []
    for (const node of ld) {
      let parsed
      try {
        parsed = JSON.parse(node.textContent || '')
      } catch {
        continue // a malformed block is not a reason to abandon the rest
      }
      const graph = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed]
      for (const entry of graph) {
        const type = String(entry?.['@type'] || '')
        if (/Product/i.test(type)) {
          products += 1
          if (samples.length < 2) samples.push(entry)
        }
        if (/BreadcrumbList/i.test(type)) breadcrumbs += 1
        if (/ItemList/i.test(type) && Array.isArray(entry.itemListElement)) {
          products += entry.itemListElement.length
          if (samples.length < 2 && entry.itemListElement[0]) samples.push(entry.itemListElement[0])
        }
      }
    }
    if (ld.length) out.push({ type: 'ld+json', count: products, breadcrumbs, samples })

    // Hydration blobs — most stable of all when present.
    for (const [type, sel] of [
      ['__NEXT_DATA__', 'script#__NEXT_DATA__'],
      ['__NUXT_DATA__', 'script#__NUXT_DATA__'],
    ]) {
      const el = document.querySelector(sel)
      if (el) out.push({ type, count: (el.textContent || '').length > 2 ? 1 : 0, samples: [] })
    }

    return out.sort((a, b) => b.count - a.count)
  }

  function tileCandidates() {
    return IHERB_TILE_CANDIDATES.map((selector) => ({
      selector,
      count: document.querySelectorAll(selector).length,
    }))
  }

  function detectPagination() {
    const next = document.querySelector('link[rel="next"], a[rel="next"]')
    if (next) {
      return { kind: 'rel-next', pages: countedPages(), next_href: next.getAttribute('href') }
    }
    const numbered = document.querySelectorAll('[class*="pagination"] a, nav[aria-label*="agination"] a')
    if (numbered.length) return { kind: 'numbered', pages: countedPages(), next_href: null }
    return { kind: 'none-or-infinite-scroll', pages: null, next_href: null }
  }

  function countedPages() {
    const nums = [...document.querySelectorAll('[class*="pagination"] a, nav[aria-label*="agination"] a')]
      .map((a) => parseInt((a.textContent || '').trim(), 10))
      .filter((n) => Number.isFinite(n))
    return nums.length ? Math.max(...nums) : null
  }

  /** First rendered price-ish text — the currency assertion depends on it. */
  function currencyText() {
    const body = document.body?.innerText || ''
    const m = body.match(/(S?\$|SGD|USD|MYR|RM)\s?\d[\d.,]*/)
    return m ? m[0] : null
  }

  function readPath(obj, path) {
    return String(path)
      .split('.')
      .reduce((acc, k) => (acc == null ? acc : acc[k]), obj)
  }

  /**
   * Probe one field. Order matters: a structured payload is worth more than an
   * attribute, which is worth more than a selector, which beats a text regex.
   */
  function probeField(spec, tile, payloadSample, pageText) {
    for (const key of spec.jsonldKeys || []) {
      if (!payloadSample) break
      const v = readPath(payloadSample, key)
      if (v !== undefined && v !== null && v !== '') {
        return { found: true, via: 'jsonld', sample: truncate(v) }
      }
    }

    if (tile) {
      for (const sel of spec.selectors || []) {
        let el
        try {
          el = tile.querySelector(sel)
        } catch {
          continue // an invalid selector must not abort the whole probe
        }
        if (!el) continue
        const text = (el.textContent || '').trim()
        const attr = el.getAttribute('content') || el.getAttribute('data-part-number') || ''
        const value = attr || text
        if (value) return { found: true, via: attr ? 'attribute' : 'selector', sample: truncate(value) }
      }
    }

    const haystack = (tile && tile.innerText) || pageText || ''
    for (const pattern of spec.textPatterns || []) {
      let re
      try {
        re = new RegExp(pattern, 'i')
      } catch {
        continue
      }
      const m = haystack.match(re)
      if (m) return { found: true, via: 'text', sample: truncate(m[0]) }
    }

    return { found: false, via: 'none', sample: null }
  }

  function truncate(v) {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.length > 120 ? `${s.slice(0, 117)}…` : s
  }

  function runProbe() {
    const catalogue = detectCatalogue()
    if (!catalogue) {
      return { ok: false, error: 'Not an iHerb brand catalogue page (expected /c/<brand>).' }
    }

    const payloads = findStructuredPayloads()
    const tiles = tileCandidates()
    const best = [...tiles].sort((a, b) => b.count - a.count)[0]
    const tile = best && best.count > 0 ? document.querySelector(best.selector) : null
    const payloadSample = payloads.find((p) => p.samples?.length)?.samples?.[0] || null
    const pageText = document.body?.innerText || ''

    const fields = {}
    for (const spec of IHERB_PROBE_FIELDS_INPAGE) {
      fields[spec.key] = probeField(spec, tile, payloadSample, pageText)
    }

    const html = document.documentElement.outerHTML

    return {
      ok: true,
      slug: catalogue.slug,
      // Raw observations only. Summarising, verdicts and diffing live in
      // marketplace/iherb/probeSpec.mjs so there is one implementation of them.
      raw: {
        url: catalogue.url,
        captured_at: new Date().toISOString(),
        html_bytes: html.length,
        structured_payloads: payloads.map(({ type, count }) => ({ type, count })),
        tile_candidates: tiles,
        pagination: detectPagination(),
        currency_text: currencyText(),
        fields,
      },
      html,
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'SKUMS_IHERB_PROBE') return
    try {
      sendResponse(runProbe())
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) })
    }
    return true
  })
})()
