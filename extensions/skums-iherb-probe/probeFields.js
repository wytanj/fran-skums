/**
 * Field probes for the in-page iHerb scan.
 *
 * MV3 content scripts cannot import the ESM module, so the selector/pattern half
 * of marketplace/iherb/probeSpec.mjs is mirrored here as a plain script. Only the
 * *observation* half is duplicated — summarising, verdicts and diffing stay in
 * the shared module and run server-side, so there is one implementation of the
 * judgement and only the DOM-facing constants are copied.
 *
 * tests/iherb-probe-spec.test.mjs asserts these keys match IHERB_PROBE_FIELDS,
 * so the copy cannot drift silently.
 *
 * @see marketplace/iherb/probeSpec.mjs
 */
// eslint-disable-next-line no-unused-vars
const IHERB_PROBE_FIELDS_INPAGE = [
  {
    key: 'name',
    jsonldKeys: ['name'],
    selectors: ['[data-testid*="product-title"]', '.product-title', 'a[href*="/pr/"]'],
    textPatterns: [],
  },
  {
    key: 'brand',
    jsonldKeys: ['brand', 'brand.name'],
    selectors: ['[data-testid*="brand"]', '[itemprop="brand"]'],
    textPatterns: [],
  },
  {
    key: 'price',
    jsonldKeys: ['offers.price', 'offers.0.price'],
    selectors: ['[data-testid*="price"]', '.product-price', 'bdi'],
    textPatterns: ['\\$\\s?\\d'],
  },
  {
    key: 'list_price',
    jsonldKeys: ['offers.priceSpecification.price'],
    selectors: ['[class*="list-price"]', 's', 'del'],
    textPatterns: [],
  },
  {
    key: 'currency',
    jsonldKeys: ['offers.priceCurrency', 'offers.0.priceCurrency'],
    selectors: ['[data-testid*="currency"]'],
    textPatterns: ['SGD', 'S\\$', 'USD'],
  },
  {
    key: 'rating',
    jsonldKeys: ['aggregateRating.ratingValue'],
    selectors: ['[itemprop="ratingValue"]', '[data-testid*="rating"]', '[class*="stars"]'],
    textPatterns: [],
  },
  {
    key: 'review_count',
    jsonldKeys: ['aggregateRating.reviewCount', 'aggregateRating.ratingCount'],
    selectors: ['[itemprop="reviewCount"]', '[data-testid*="review"]', '[class*="review-count"]'],
    textPatterns: ['\\d[\\d,]*\\s*(reviews?|ratings?)'],
  },
  {
    key: 'sold_per_month',
    jsonldKeys: [],
    selectors: ['[data-testid*="sold"]', '[class*="sold"]', '[class*="bought"]'],
    textPatterns: [
      '\\d[\\d,]*\\+?\\s*(sold|bought)',
      'bought\\s+in\\s+past\\s+month',
      'sold\\s*/\\s*month',
    ],
  },
  {
    key: 'category_breadcrumb',
    jsonldKeys: ['itemListElement'],
    selectors: [
      'nav[aria-label*="readcrumb"]',
      '[data-testid*="breadcrumb"]',
      '.breadcrumb',
      'ol[itemtype*="BreadcrumbList"]',
    ],
    textPatterns: [],
  },
  {
    key: 'product_code',
    jsonldKeys: ['sku', 'mpn', 'productID'],
    selectors: ['[data-part-number]', '[data-product-id]', '[itemprop="sku"]'],
    textPatterns: ['\\bIHB-?\\d+', '#\\d{4,}'],
  },
  {
    key: 'pack_size',
    jsonldKeys: ['size', 'weight'],
    selectors: ['[data-testid*="size"]', '[class*="pack-size"]'],
    textPatterns: ['\\d+(\\.\\d+)?\\s?(ml|g|oz|fl\\.?\\s?oz|count|ct)\\b'],
  },
  {
    key: 'in_stock',
    jsonldKeys: ['offers.availability', 'offers.0.availability'],
    selectors: ['[class*="out-of-stock"]', '[class*="stock"]', '[data-testid*="stock"]'],
    textPatterns: ['out of stock', 'in stock', 'back in stock'],
  },
  {
    key: 'product_url',
    jsonldKeys: ['url', 'offers.url'],
    selectors: ['a[href*="/pr/"]'],
    textPatterns: [],
  },
]

/** Tile candidates, broad → narrow. The one that repeats most wins. */
// eslint-disable-next-line no-unused-vars
const IHERB_TILE_CANDIDATES = [
  '[data-testid="product-card"]',
  '[data-testid*="product-card"]',
  '.product-cell-container',
  '[class*="product-card"]',
  '.product-inner',
  'li[class*="product"]',
  '[itemtype*="schema.org/Product"]',
]
