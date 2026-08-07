/**
 * iHerb probe side panel.
 *
 * Sends raw observations to the API, which summarises them with the shared
 * module — so the verdict logic has one implementation and the extension carries
 * only the DOM-facing constants. If the API is unreachable the raw capture is
 * still downloadable, because the expensive half is being on the page at all.
 *
 * @see marketplace/iherb/probeSpec.mjs
 * @see server/api/v1/marketplace/iherb/probe.post.ts
 */
const $ = (id) => document.getElementById(id)

let lastCapture = null

function apiBase() {
  return $('apiBase').value.trim().replace(/\/$/, '')
}

function authHeaders() {
  const key = $('apiKey').value.trim()
  return key ? { authorization: `Bearer ${key}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function refreshHeader() {
  const tab = await activeTab()
  const url = tab?.url || ''
  $('pageUrl').textContent = url ? url.replace(/^https?:\/\//, '').slice(0, 44) : '—'
  const m = url.match(/\/c\/([^/?#]+)/i)
  $('slug').textContent = m ? decodeURIComponent(m[1]).toLowerCase() : '—'
  $('probe').disabled = !m
}

function pill(found, via) {
  if (!found) return '<span class="no">not found</span>'
  const cls = via === 'jsonld' ? 'ok' : via === 'text' ? 'warn' : ''
  return `<span class="${cls}">${via}</span>`
}

function renderReport(report) {
  $('resultBox').style.display = ''
  $('tileSel').textContent = report.tile_selector || '—'
  $('tileCount').textContent = report.tile_count ?? 0
  $('payload').textContent = report.structured_payload
    ? `${report.structured_payload.type} × ${report.structured_payload.count}`
    : 'none'
  $('pagination').textContent = report.pagination?.kind
    ? `${report.pagination.kind}${report.pagination.pages ? ` · ${report.pagination.pages}p` : ''}`
    : 'unknown'

  // Currency is asserted, not assumed — a silent USD run poisons an SGD column.
  const cur = report.currency
  $('currency').innerHTML = cur === 'SGD'
    ? '<span class="ok">SGD ✓</span>'
    : cur
      ? `<span class="bad">${cur} — not SGD</span>`
      : '<span class="warn">unknown</span>'

  const v = report.verdict || {}
  const tone = v.approach === 'structured_payload' ? '#132e1a'
    : v.approach === 'dom_selectors' ? '#2b2412'
      : '#2d1416'
  $('verdict').style.background = tone
  $('verdict').innerHTML = `<strong>${v.approach || 'unknown'}</strong> · ${v.confidence || '—'}<br>${v.reason || ''}`

  $('fields').innerHTML = (report.fields || [])
    .map((f) => `<div class="row"><span class="k">${f.label}</span>${pill(f.found, f.via)}</div>`)
    .join('')
}

/**
 * Ask the page to probe, injecting the content script first if it is not there.
 *
 * A tab that was already open when the extension was loaded never received the
 * declarative content script, and sendMessage fails with "Receiving end does not
 * exist". Injecting on demand fixes that without making the operator reload —
 * content.js is idempotent, so a redundant injection is harmless.
 */
async function askPage(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'SKUMS_IHERB_PROBE' })
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['probeFields.js', 'content.js'],
    })
    return chrome.tabs.sendMessage(tabId, { type: 'SKUMS_IHERB_PROBE' })
  }
}

async function probe() {
  $('probe').disabled = true
  $('probe').textContent = 'Probing…'
  try {
    const tab = await activeTab()
    if (!tab?.id) throw new Error('No active tab.')
    if (!/^https:\/\/([a-z]+\.)?iherb\.com\//i.test(tab.url || '')) {
      throw new Error(`Not an iHerb tab — this panel is looking at ${tab.url || 'nothing'}.`)
    }

    let res
    try {
      res = await askPage(tab.id)
    } catch (e) {
      throw new Error(
        `Could not reach the page (${e?.message || e}). If it keeps happening, reload the iHerb tab — `
        + 'Chrome only injects content scripts into tabs opened after the extension was loaded.',
      )
    }
    if (!res?.ok) throw new Error(res?.error || 'Probe returned nothing.')

    lastCapture = res

    let report = null
    try {
      const r = await fetch(`${apiBase()}/api/v1/marketplace/iherb/probe`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ slug: res.slug, raw: res.raw }),
      })
      if (r.ok) report = (await r.json()).report
    } catch {
      /* offline is survivable — the capture is the valuable part */
    }

    if (!report) {
      report = {
        ...res.raw,
        tile_selector: [...res.raw.tile_candidates].sort((a, b) => b.count - a.count)[0]?.selector || null,
        tile_count: [...res.raw.tile_candidates].sort((a, b) => b.count - a.count)[0]?.count || 0,
        structured_payload: res.raw.structured_payloads?.[0] || null,
        currency: /SGD|S\$/i.test(res.raw.currency_text || '') ? 'SGD' : null,
        fields: Object.entries(res.raw.fields).map(([key, o]) => ({ key, label: key, ...o })),
        verdict: { approach: 'unsummarised', confidence: '—', reason: 'API unreachable — raw capture only.' },
      }
    }
    renderReport(report)
  } catch (e) {
    $('resultBox').style.display = ''
    $('verdict').style.background = '#2d1416'
    $('verdict').textContent = String(e.message || e)
  } finally {
    $('probe').disabled = false
    $('probe').textContent = 'Probe structure'
  }
}

function download() {
  if (!lastCapture) return
  const slug = lastCapture.slug || 'iherb'
  for (const [name, body, type] of [
    [`sample-iherb-${slug}.html`, lastCapture.html, 'text/html'],
    [`sample-iherb-${slug}.probe.json`, JSON.stringify(lastCapture.raw, null, 2), 'application/json'],
  ]) {
    const url = URL.createObjectURL(new Blob([body], { type }))
    chrome.downloads.download({ url, filename: name, saveAs: false })
  }
}

;(async function init() {
  const s = await chrome.storage.sync.get(['apiBase', 'apiKey'])
  $('apiBase').value = s.apiBase || 'https://fran-skums.vercel.app'
  $('apiKey').value = s.apiKey || ''
  $('save').addEventListener('click', async () => {
    await chrome.storage.sync.set({ apiBase: $('apiBase').value.trim(), apiKey: $('apiKey').value.trim() })
    $('save').textContent = 'Saved'
    setTimeout(() => ($('save').textContent = 'Save'), 1200)
  })
  $('probe').addEventListener('click', probe)
  $('download').addEventListener('click', download)
  await refreshHeader()
  chrome.tabs.onActivated.addListener(refreshHeader)
  chrome.tabs.onUpdated.addListener(refreshHeader)
})()
