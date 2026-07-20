/**
 * Side panel — Mall shop product harvest (name / sold / category).
 */

const $ = (id) => document.getElementById(id)
const CACHE_KEY = 'skums_brand_cache_v1'
const HARVEST_KEY = 'skums_last_harvest_v1'
const COLL_KEY = 'skums_last_collections_v1'

let brands = []
let lastWorkspaceId = null
let selectedBrandKey = ''
let brandFilter = ''
/** @type {string | null} */
let activeShopUsername = null
/** @type {any} */
let lastHarvest = null
/** @type {any} */
let lastCollections = null

const BM = () => globalThis.SkumsBrandMatch

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

async function persistCollections() {
  if (lastCollections) {
    await chrome.storage.local.set({ [COLL_KEY]: lastCollections })
  }
}

async function restoreCaches() {
  const stored = await chrome.storage.local.get([CACHE_KEY, HARVEST_KEY, COLL_KEY])
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
  if (stored[COLL_KEY]?.collections?.length) {
    lastCollections = stored[COLL_KEY]
    renderCollections(lastCollections)
  }
}

function renderCollections(disc) {
  lastCollections = disc
  const meta = $('collectionsMeta')
  const box = $('collectionsBox')
  const list = disc?.collections || []
  meta.textContent = disc
    ? `@${disc.shop_username || '?'} · ${list.length} collections · ${disc.discovered_at || ''}`
    : ''
  if (!list.length) {
    box.innerHTML = '<div class="muted">No collections found. Open Mall home (not a PDP).</div>'
    $('btnPushCollections').disabled = true
    return
  }
  box.innerHTML =
    '<table><thead><tr><th>Shelf name</th><th>shopCollection id</th></tr></thead><tbody>' +
    list
      .map(
        (c) =>
          `<tr><td>${esc(c.name)}</td><td><code>${esc(c.shop_collection_id || '— (All Products)')}</code></td></tr>`,
      )
      .join('') +
    '</tbody></table>'
  $('btnPushCollections').disabled = false
}

function renderBrandSelect() {
  const sel = $('brandSelect')
  const prev = selectedBrandKey || sel.value
  sel.innerHTML = ''
  const opt0 = document.createElement('option')
  opt0.value = ''
  const needN = brands.filter(needsShop).length
  opt0.textContent = brands.length
    ? `— pick brand (${needN} need shop · ${brands.length} total) —`
    : '— load brands —'
  sel.appendChild(opt0)

  const q = brandFilter.trim().toLowerCase()
  const sorted = [...brands]
    .filter((b) => {
      if (!q) return true
      const hay = `${b.display_name} ${b.brand_key} ${b.shop_username || ''}`.toLowerCase()
      return hay.includes(q)
    })
    .sort((a, b) => {
      // Unconfirmed first (what you're linking), then pilot, then name
      const an = needsShop(a) ? 0 : 1
      const bn = needsShop(b) ? 0 : 1
      if (an !== bn) return an - bn
      const ap = a.pilot_tier === 'pilot' ? 0 : 1
      const bp = b.pilot_tier === 'pilot' ? 0 : 1
      if (ap !== bp) return ap - bp
      return String(a.display_name || '').localeCompare(String(b.display_name || ''))
    })

  for (const b of sorted) {
    const o = document.createElement('option')
    o.value = b.brand_key
    const flag = !needsShop(b) ? '✓' : b.shop_username ? '~' : '·'
    const mark = b.shop_username ? `@${b.shop_username}` : 'no shop yet'
    o.textContent = `${flag} ${b.display_name} · ${mark}`
    sel.appendChild(o)
  }
  if (prev && [...sel.options].some((o) => o.value === prev)) {
    sel.value = prev
    selectedBrandKey = prev
  } else if (sorted.length === 1) {
    // Filter narrowed to one brand — select it
    sel.value = sorted[0].brand_key
    selectedBrandKey = sorted[0].brand_key
  }
  updateLinkButton()
}

function updateLinkButton() {
  const btn = $('btnLinkShop')
  if (!btn) return
  const user = activeShopUsername
  const brand = $('brandSelect').value
  if (user && brand) {
    btn.textContent = `Link @${user} → ${brand}`
    btn.disabled = false
  } else if (user) {
    btn.textContent = `Link @${user} → (pick brand)`
    btn.disabled = true
  } else {
    btn.textContent = 'Link this Mall page to brand'
    btn.disabled = true
  }
}

/**
 * Read active Shopee tab, guess brand from @username, preselect dropdown.
 */
async function syncFromActiveTab(opts = {}) {
  const quiet = opts.quiet === true
  const tab = await getShopeeTab()
  if (!tab?.url) {
    activeShopUsername = null
    if ($('linkMeta')) {
      $('linkMeta').textContent = 'No Shopee tab found. Open a Mall shop URL first.'
    }
    updateLinkButton()
    return null
  }

  const username =
    BM()?.usernameFromShopUrl?.(tab.url) ||
    null
  activeShopUsername = username

  let guess = null
  if (username && brands.length && BM()?.guessBrandForShop) {
    guess = BM().guessBrandForShop(brands, {
      shop_username: username,
      page_title: tab.title || '',
      prefer_unconfirmed: true,
    })
    if (guess?.brand?.brand_key) {
      selectedBrandKey = guess.brand.brand_key
      // Clear filter so the option is visible, then render
      if ($('brandFilter') && brandFilter) {
        brandFilter = ''
        $('brandFilter').value = ''
      }
      renderBrandSelect()
      $('brandSelect').value = guess.brand.brand_key
    }
  }

  if ($('linkMeta')) {
    if (!username) {
      $('linkMeta').textContent =
        `Tab is not a Mall shop path (${tab.url}). Open e.g. shopee.sg/{username}.`
    } else if (guess) {
      $('linkMeta').textContent =
        `Detected @${username} → suggested ${guess.brand.display_name} (${guess.brand.brand_key}, score ${guess.score}). Click Link if correct.`
    } else if (!brands.length) {
      $('linkMeta').textContent = `Detected @${username}. Refresh brands first, then Link.`
    } else {
      $('linkMeta').textContent =
        `Detected @${username} — no auto-match. Type filter or pick brand, then Link.`
    }
  }

  updateLinkButton()
  if (!quiet && username) {
    setStatus(
      guess
        ? `Ready: @${username} → ${guess.brand.brand_key}. Press Link.`
        : `On @${username}. Pick brand (filter helps), then Link.`,
      guess ? 'ok' : 'muted',
    )
  }
  return { tab, username, guess }
}

async function linkActiveShop() {
  if (!$('apiKey').value.trim()) throw new Error('API key required')
  if (!brands.length) await loadBrands()

  const tab = await getShopeeTab()
  if (!tab?.url) throw new Error('Open a Shopee Mall shop tab first')

  const username = BM()?.usernameFromShopUrl?.(tab.url)
  if (!username) {
    throw new Error('URL is not a shop path like shopee.sg/beautyofjoseonsg')
  }

  // Re-guess if select empty
  if (!$('brandSelect').value && brands.length) {
    const g = BM()?.guessBrandForShop?.(brands, {
      shop_username: username,
      page_title: tab.title || '',
    })
    if (g?.brand?.brand_key) {
      $('brandSelect').value = g.brand.brand_key
      selectedBrandKey = g.brand.brand_key
    }
  }

  const brand_key = $('brandSelect').value
  if (!brand_key) throw new Error('Select a brand (use filter or Re-guess)')

  setStatus(`Linking @${username} → ${brand_key}…`)
  const data = await apiPost('/api/v1/marketplace/brand-universe/resolve-shop', {
    brand_key,
    status: 'confirmed',
    source: 'manual',
    shop_username: username,
    shop_url: `https://shopee.sg/${username}`,
    evidence: {
      via: 'chrome_extension_side_panel',
      page_url: tab.url,
      page_title: tab.title || null,
    },
  })

  setStatus(
    `Linked @${data.brand?.shop_username || username} → ${data.brand?.brand_key || brand_key}\n` +
      `Next: open another Mall shop (panel stays open).`,
    'ok',
  )
  await loadBrands()
  activeShopUsername = username
  // Keep selection on confirmed brand briefly, then clear for next
  selectedBrandKey = ''
  $('brandSelect').value = ''
  brandFilter = ''
  if ($('brandFilter')) $('brandFilter').value = ''
  renderBrandSelect()
  updateLinkButton()
  if ($('linkMeta')) {
    $('linkMeta').textContent =
      `Saved @${username}. Open the next Mall page → Re-guess / Link.`
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

async function discoverCollections() {
  const tab = await getShopeeTab()
  if (!tab?.id) {
    setStatus('Open a Shopee Mall shop home tab first (e.g. beautyofjoseonsg)', 'err')
    return
  }
  setStatus(`Discovering collections: ${tab.title || tab.url}…`)
  const res = await sendToTab(tab.id, { type: 'SKUMS_DISCOVER_COLLECTIONS' })
  if (!res?.ok) {
    setStatus(res?.error || 'Discover failed — reload shop tab', 'err')
    return
  }
  const disc = res.discovery
  activeShopUsername = disc.shop_username || activeShopUsername
  if (disc.shop_username && brands.length) {
    const exact = brands.find(
      (b) => String(b.shop_username || '').toLowerCase() === disc.shop_username,
    )
    const guess =
      exact ||
      BM()?.guessBrandForShop?.(brands, {
        shop_username: disc.shop_username,
        page_title: tab.title || '',
      })?.brand
    if (guess) {
      $('brandSelect').value = guess.brand_key
      selectedBrandKey = guess.brand_key
      await persistBrandCache()
    }
  }
  updateLinkButton()
  renderCollections(disc)
  await persistCollections()
  setStatus(
    `Found ${disc.collections?.length || 0} shelves for @${disc.shop_username || '?'}\n` +
      `Push to save on brand universe (MH-1). Then harvest list pages (MH-2).`,
    disc.collections?.length ? 'ok' : 'err',
  )
}

async function pushCollections() {
  if (!lastCollections?.collections?.length) throw new Error('No collections discovered')
  if (!$('apiKey').value.trim()) throw new Error('API key required')
  const brand_key = $('brandSelect').value || undefined
  setStatus('Pushing collections…')
  const data = await apiPost('/api/v1/marketplace/brand-universe/collections', {
    brand_key,
    shop_username: lastCollections.shop_username,
    collections: lastCollections.collections,
    confirm_shop: true,
  })
  setStatus(
    `Saved ${data.collection_count} collections on ${data.brand_key} (@${data.shop_username})`,
    'ok',
  )
  await loadBrands()
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
  activeShopUsername = harvest.shop_username || activeShopUsername
  // Auto-select brand by exact shop_username, else fuzzy @username
  if (harvest.shop_username && brands.length) {
    const exact = brands.find(
      (b) => String(b.shop_username || '').toLowerCase() === harvest.shop_username,
    )
    const guess =
      exact ||
      BM()?.guessBrandForShop?.(brands, {
        shop_username: harvest.shop_username,
        page_title: tab.title || '',
      })?.brand
    if (guess) {
      $('brandSelect').value = guess.brand_key
      selectedBrandKey = guess.brand_key
      await persistBrandCache()
    }
  }
  updateLinkButton()

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
  loadBrands()
    .then(() => syncFromActiveTab({ quiet: true }))
    .catch((e) => setStatus(String(e.message || e), 'err')),
)
$('btnLinkShop').addEventListener('click', () =>
  linkActiveShop().catch((e) => setStatus(e.message, 'err')),
)
$('btnGuessBrand').addEventListener('click', () =>
  syncFromActiveTab().catch((e) => setStatus(e.message, 'err')),
)
$('btnDiscover').addEventListener('click', () =>
  discoverCollections().catch((e) => setStatus(e.message, 'err')),
)
$('btnPushCollections').addEventListener('click', () =>
  pushCollections().catch((e) => setStatus(e.message, 'err')),
)
$('btnHarvest').addEventListener('click', () =>
  harvestActiveShop().catch((e) => setStatus(e.message, 'err')),
)
$('btnPush').addEventListener('click', () => pushHarvest().catch((e) => setStatus(e.message, 'err')))
$('btnDownload').addEventListener('click', () => downloadHarvest())
$('brandSelect').addEventListener('change', async () => {
  selectedBrandKey = $('brandSelect').value
  updateLinkButton()
  await persistBrandCache()
})
$('brandFilter').addEventListener('input', () => {
  brandFilter = $('brandFilter').value
  renderBrandSelect()
})

// Re-guess when user switches Shopee tabs (panel stays open)
if (chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(() => {
    syncFromActiveTab({ quiet: true }).catch(() => {})
  })
}
if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (info.status === 'complete' && tab?.active && /shopee\.sg/i.test(tab.url || '')) {
      syncFromActiveTab({ quiet: true }).catch(() => {})
    }
  })
}

;(async () => {
  try {
    await loadSettings()
    await restoreCaches()
    if (!brands.length && $('apiKey').value.trim()) {
      await loadBrands()
    } else if (!$('apiKey').value.trim()) {
      $('settingsBox').open = true
      setStatus('Settings → API key → Save → Refresh brands', 'muted')
    }
    await syncFromActiveTab({ quiet: !brands.length })
    if (brands.length) {
      setStatus('Ready. Mall page → Link (auto brand) · or Discover / Harvest.', 'ok')
    }
  } catch (e) {
    setStatus(String(e.message || e), 'err')
    $('settingsBox').open = true
  }
})()
