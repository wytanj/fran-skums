import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const wooClient = readFileSync(new URL('../channels/woocommerce/client.ts', import.meta.url), 'utf8')
const wooAdapter = readFileSync(new URL('../channels/woocommerce/adapter.ts', import.meta.url), 'utf8')
const wooIndex = readFileSync(new URL('../channels/woocommerce/index.ts', import.meta.url), 'utf8')
const channelImports = readFileSync(new URL('../channels/_imports.ts', import.meta.url), 'utf8')
const workspaceAccess = readFileSync(new URL('../server/utils/workspaceAccess.ts', import.meta.url), 'utf8')
const testRoute = readFileSync(new URL('../server/api/integrations/woocommerce/test.post.ts', import.meta.url), 'utf8')
const pullRoute = readFileSync(new URL('../server/api/integrations/woocommerce/pull-products.post.ts', import.meta.url), 'utf8')
const integrationComposable = readFileSync(new URL('../app/composables/useIntegrations.ts', import.meta.url), 'utf8')
const integrationsPage = readFileSync(new URL('../app/pages/integrations.vue', import.meta.url), 'utf8')

test('WooCommerce adapter is registered and uses API-key credentials', () => {
  assert.match(wooAdapter, /id: 'woocommerce'/)
  assert.match(wooAdapter, /type: 'api_key'/)
  assert.match(wooAdapter, /required_fields: \['site_url', 'consumer_key', 'consumer_secret'\]/)
  assert.match(wooIndex, /registerChannelAdapter\(woocommerceAdapter\)/)
  assert.match(channelImports, /'.\/woocommerce'/)
})

test('WooCommerce client reads the official products endpoint in bounded pages', () => {
  assert.match(wooClient, /\/wp-json\/wc\/v3\/\$\{cleanPath\(path\)\}/)
  assert.match(wooClient, /Authorization: `Basic/)
  assert.match(wooClient, /WooCommerce site_url must use HTTPS/)
  assert.match(wooClient, /per_page: perPage/)
  assert.match(wooClient, /Math\.min\(Math\.max\(Math\.floor\(opts\.perPage \|\| 100\), 1\), 100\)/)
  assert.match(wooClient, /x-wp-totalpages/)
  assert.match(wooClient, /next_page: hasMore \? page \+ 1 : null/)
})

test('WooCommerce mapping preserves external product data and SKUMS merge fields', () => {
  assert.match(wooClient, /mapWooCommerceProductToSkumsProduct/)
  assert.match(wooClient, /raw_product: product/)
  assert.match(wooClient, /extractWooCommerceIdentifiers/)
  assert.match(wooClient, /extractWooCommerceBrand/)
  assert.match(wooClient, /product_data: \{/)
  assert.match(wooClient, /source: 'woocommerce'/)
  assert.match(wooClient, /mapWooCommerceVariationToSkumsVariant/)
})

test('WooCommerce UI routes require session workspace access and service-side authorization', () => {
  assert.match(workspaceAccess, /serverSupabaseUser\(event\)/)
  assert.match(workspaceAccess, /\.from\('workspaces'\)/)
  assert.match(workspaceAccess, /\.from\('workspace_members'\)/)
  assert.match(workspaceAccess, /\.from\('organization_members'\)/)
  assert.match(testRoute, /requireWorkspaceAccess\(event, client, credential\.workspace_id, 'write'\)/)
  assert.match(testRoute, /node\?\.slug !== 'woocommerce'/)
  assert.match(testRoute, /testWooCommerceCredentials/)
  assert.match(testRoute, /is_valid: true/)
})

test('WooCommerce product pull writes products, mappings, executions, and connection status', () => {
  assert.match(pullRoute, /requireWorkspaceAccess\(event, client, connection\.workspace_id, 'write'\)/)
  assert.match(pullRoute, /nodeSlug\(connection\) !== 'woocommerce'/)
  assert.match(pullRoute, /fetchWooCommerceProductsPage/)
  assert.match(pullRoute, /maxPages/)
  assert.match(pullRoute, /\.from\('products'\)/)
  assert.match(pullRoute, /\.from\('product_images'\)/)
  assert.match(pullRoute, /\.from\('product_variants'\)/)
  assert.match(pullRoute, /\.from\('integration_sync_mappings'\)/)
  assert.match(pullRoute, /\.from\('integration_executions'\)/)
  assert.match(pullRoute, /last_synced_at/)
  assert.match(pullRoute, /next_page: hasMore \? nextPage : null/)
})

test('Integration UI exposes WooCommerce credential testing and product pulls', () => {
  assert.match(integrationComposable, /\/api\/integrations\/woocommerce\/test/)
  assert.match(integrationComposable, /pullWooCommerceProducts/)
  assert.match(integrationComposable, /\/api\/integrations\/woocommerce\/pull-products/)
  assert.match(integrationsPage, /isWooCommerceCredential/)
  assert.match(integrationsPage, /handleTestCredential/)
  assert.match(integrationsPage, /isWooCommerceConnection/)
  assert.match(integrationsPage, /handlePullWooCommerce/)
  assert.match(integrationsPage, /Pull products/)
  assert.match(integrationsPage, /Continue pull/)
})
