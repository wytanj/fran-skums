import { mockCollectAdapter } from './mock/adapter.mjs'
import { shopeePuppeteerAdapter } from './shopee-puppeteer/adapter.mjs'
import { cloudflareBrowserRunAdapter } from './cloudflare-browser-run/adapter.mjs'

/** @type {Map<string, import('./types.mjs').CollectAdapter>} */
const adapters = new Map()

export function registerCollectAdapter(adapter) {
  if (!adapter?.id) throw new Error('CollectAdapter requires id')
  adapters.set(adapter.id, adapter)
}

export function getCollectAdapter(id) {
  return adapters.get(id) || null
}

export function listCollectAdapterIds() {
  return [...adapters.keys()]
}

// Built-ins — shopee_puppeteer scrapeSeed is a stub; use marketplaceCollect.runCollector
registerCollectAdapter(mockCollectAdapter)
registerCollectAdapter(shopeePuppeteerAdapter)
registerCollectAdapter(cloudflareBrowserRunAdapter)
