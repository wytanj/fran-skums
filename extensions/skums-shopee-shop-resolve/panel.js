/**
 * Side panel — Mall shop product harvest (name / sold / category).
 */

const $ = (id) => document.getElementById(id)
const CACHE_KEY = 'skums_brand_cache_v1'
const HARVEST_KEY = 'skums_last_harvest_v1'

let brands = []
let lastWorkspaceId = null
let selectedBrandKey = ''
/** @type {any} */
let lastHarvest = null

function setStatus(msg, cls) {
  const el = $('status')
  el.textContent = msg
  el.className = cls || 'muted'
}

function apiBase() {
  return $('apiBase').value.trim().replace(/\/$/, '')
}

function authHeaders() {
  return {
    Authorization: `Bearer ${$('apiKey').value.trim()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

function parseApiBody(res, text) {
  const t = String(text || '').trim()
  if (t.startsWith('<!DOCTYPE') || t.startsWith('<html')) {
    throw new Error(
      `Got HTML from ${apiBase()} — brand/shop API not on this host.\nUse https://fran-skums.vercel.app after deploy.`,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON (${res.status}): ${text.slice(0, 140)}`)
  }
}

async function apiGet(path) {
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() })
  const text = await res.text()
  const json = parseApiBody(res, text)
  if (!res.ok) throw new Error(json.statusMessage || json.message || `HTTP ${res.status}`)
  return json
}

async function apiPost(path, body) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const json = parseApiBody(res, text)
  if (!res.ok) throw new Error(json.statusMessage || json.message || `HTTP ${res.status}`)
  return json
}

function needsShop(b) {
  return !b.shop_username || b.shop_resolve_status !== 'confirmed'
}

async function loadSettings() {
  const s = await chrome.storage.sync.get(['apiBase', 'apiKey'])
  $('apiBase').value = s.apiBase || 'https://fran-skums.vercel.app'
  $('apiKey').value = s.apiKey || ''
}

async function saveSettings() {
  await chrome.storage.sync.set({
    apiBase: apiBase(),
    apiKey: $('apiKey').value.trim(),
  })
  setStatus('Settings saved', 'ok')
}

async function persistBrandCache() {
  await chrome.storage.local.set({
    [CACHE_KEY]: {
      brands,
      workspace_id: lastWorkspaceId,
      selectedBrandKey,
      saved_at: Date.now(),
      apiBase: apiBase(),
    },
  })
}

async function persistHarvest() {
  if (lastHarvest) {
    await chrome.storage.local.set({ [HARVEST_KEY]: lastHarvest })
  }
}

async function restoreCaches() {
  const stored = await chrome.storage.local.get([CACHE_KEY, HARVEST_KEY])
  const cache = stored[CACHE_KEY]
  if (cache?.brands?.length && (!cache.apiBase || cache.apiBase === apiBase())) {
    brands = cache.brands
    lastWorkspaceId = cache.workspace_id || null
    selectedBrandKey = cache.selectedBrandKey || ''
    renderBrandSelect()
    if (selectedBrandKey) $('brandSelect').value = selectedBrandKey
    const need = brands.filter(needsShop).length
    $('brandMeta').textContent = `${brands.length} brands cached · ${need} need shop username`
  }
  if (stored[HARVEST_KEY]?.products?.length) {
    lastHarvest = stored[HARVEST_KEY]
    renderHarvest(lastHarvest)
  }
}

function renderBrandSelect() {
  const sel = $('brandSelect')
  const prev = selectedBrandKey || sel.value
  sel.innerHTML = ''
  const opt0 = document.createElement('option')
  opt0.value = ''
  opt0.textContent = brands.length ? `— auto by shop_username (${brands.length}) —` : '— load brands —'
  sel.appendChild(opt0)
  const sorted = [...brands].sort((a, b) => {
    const ap = a.pilot_tier === 'pilot' ? 0 : 1
    const bp = b.pilot_tier === 'pilot' ? 0 : 1
    if (ap !== bp) return ap - bp
    return String(a.display_name || '').localeCompare(String(b.display_name || ''))
  })
  for (const b of sorted) {
    const o = document.createElement('option')
    o.value = b.brand_key
    const mark = b.shop_username ? `@${b.shop_username}` : 'no shop yet'
    o.textContent = `${b.display_name} · ${mark}`
    sel.appendChild(o)
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) {
    sel.value = prev
    selectedBrandKey = prev
  }
}

async function loadBrands() {
  if (!$('apiKey').value.trim()) {
    $('settingsBox').open = true
    setStatus('Paste API key in Settings first', 'err')
    return
  }
  setStatus('Loading brands…')
  const data = await apiGet('/api/v1/marketplace/brand-universe?limit=300')
  brands = Array.isArray(data.brands) ? data.brands : []
  lastWorkspaceId = data.workspace_id || null
  renderBrandSelect()
  await persistBrandCache()
  if (!brands.length) {
    setStatus(`0 brands for workspace ${lastWorkspaceId || '?'}. Wrong key/workspace?`, 'err')
    return
  }
  $('brandMeta').textContent = `${brands.length} brands · ws ${lastWorkspaceId || '?'}`
  setStatus(`Loaded ${brands.length} brands`, 'ok')
}

function renderHarvest(h) {
  lastHarvest = h
  const meta = $('harvestMeta')
  meta.textContent = h
    ? `@${h.shop_username || '?'} · page ${h.page} · sort ${h.sort_by || 'pop'} · category “${h.active_category || 'All Products'}” · ${h.product_count || 0} products`
    : ''

  const box = $('productTable')
  const products = h?.products || []
  if (!products.length) {
    box.innerHTML = '<div class="muted">No products found on this page.</div>'
    $('btnPush').disabled = true
    $('btnDownload').disabled = true
    return
  }

  const rows = products
    .slice(0, 80)
    .map(
      (p) => `<tr>
      <td>${esc(p.name || '')}</td>
      <td>${esc(p.sold_label || '—')}</td>
      <td>${esc(p.category || h.active_category || '')}</td>
    </tr>`,
    )
    .join('')

  box.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Sold</th><th>Category</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${products.length > 80 ? `<p class="muted">Showing 80 of ${products.length}</p>` : ''}`

  $('btnPush').disabled = false
  $('btnDownload').disabled = false
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function getShopeeTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (active?.id && active.url && /shopee\.sg/i.test(active.url)) return active
  const tabs = await chrome.tabs.query({ url: ['https://shopee.sg/*', 'https://*.shopee.sg/*'] })
  return tabs.length ? tabs[tabs.length - 1] : null
}

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg)
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    return chrome.tabs.sendMessage(tabId, msg)
  }
}

async function harvestActiveShop() {
  const tab = await getShopeeTab()
  if (!tab?.id) {
    setStatus('Open a Shopee Mall shop tab first (e.g. beautyofjoseonsg?sortBy=pop)', 'err')
    return
  }
  if (!/shopee\.sg\/[a-z0-9._-]+/i.test(tab.url || '') && !String(tab.url).includes('shopee.sg')) {
    setStatus('Active tab is not a Shopee page', 'err')
    return
  }

  setStatus(`Harvesting: ${tab.title || tab.url}…`)
  const res = await sendToTab(tab.id, { type: 'SKUMS_HARVEST_SHOP' })
  if (!res?.ok) {
    setStatus(res?.error || 'Harvest failed — reload Shopee tab and retry', 'err')
    return
  }

  const harvest = res.harvest
  // Auto-select brand by shop_username
  if (harvest.shop_username && brands.length) {
    const match = brands.find(
      (b) => String(b.shop_username || '').toLowerCase() === harvest.shop_username,
    )
    if (match) {
      $('brandSelect').value = match.brand_key
      selectedBrandKey = match.brand_key
      await persistBrandCache()
    }
  }

  renderHarvest(harvest)
  await persistHarvest()

  const withSold = (harvest.products || []).filter((p) => p.sold_label).length
  setStatus(
    `Harvested ${harvest.product_count} products (${withSold} with sold) from @${harvest.shop_username || '?'}\n` +
      `Category: ${harvest.active_category}\n` +
      `Tip: change page=1,2… on the shop URL and harvest again to cover more SKUs.`,
    harvest.product_count ? 'ok' : 'err',
  )
}

async function pushHarvest() {
  if (!lastHarvest?.products?.length) throw new Error('Nothing harvested')
  if (!$('apiKey').value.trim()) throw new Error('API key required')

  const brand_key = $('brandSelect').value || undefined
  setStatus('Pushing harvest to SKUMS…')
  const data = await apiPost('/api/v1/marketplace/shop-harvest', {
    ...lastHarvest,
    brand_key,
  })
  setStatus(
    `Pushed ${data.product_count} products` +
      (data.brand_key ? ` · brand ${data.brand_key}` : '') +
      `\nlistings upserted: ${data.write?.listings_upserted ?? '?'} · snapshots: ${data.write?.snapshots_inserted ?? '?'}`,
    'ok',
  )
}

function downloadHarvest() {
  if (!lastHarvest) return
  const blob = new Blob([JSON.stringify(lastHarvest, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `shop-harvest-${lastHarvest.shop_username || 'shop'}-p${lastHarvest.page || 0}.json`
  a.click()
  URL.revokeObjectURL(url)
  setStatus('Downloaded JSON', 'ok')
}

$('btnSave').addEventListener('click', () => saveSettings().catch((e) => setStatus(e.message, 'err')))
$('btnLoadBrands').addEventListener('click', () =>
  loadBrands().catch((e) => setStatus(String(e.message || e), 'err')),
)
$('btnHarvest').addEventListener('click', () =>
  harvestActiveShop().catch((e) => setStatus(e.message, 'err')),
)
$('btnPush').addEventListener('click', () => pushHarvest().catch((e) => setStatus(e.message, 'err')))
$('btnDownload').addEventListener('click', () => downloadHarvest())
$('brandSelect').addEventListener('change', async () => {
  selectedBrandKey = $('brandSelect').value
  await persistBrandCache()
})

;(async () => {
  try {
    await loadSettings()
    await restoreCaches()
    if (!brands.length && $('apiKey').value.trim()) {
      await loadBrands()
    } else if (!$('apiKey').value.trim()) {
      $('settingsBox').open = true
      setStatus('Settings → API key → Save → Refresh brands (optional for push)', 'muted')
    } else {
      setStatus('Ready. Open Mall shop page → Harvest products.', 'ok')
    }
  } catch (e) {
    setStatus(String(e.message || e), 'err')
    $('settingsBox').open = true
  }
})()
