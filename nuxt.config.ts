export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Vertical app layers. Each layer is a Nuxt-flavored module that
  // extends the core app with industry-specific routes, components,
  // and server endpoints. See STRUCTURE.md and apps/<id>/manifest.ts.
  extends: [
    './apps/skincare',
  ],

  modules: [
    '@nuxtjs/supabase',
    '@nuxtjs/tailwindcss',
    '@nuxtjs/color-mode',
  ],

  supabase: {
    redirect: true,
    redirectOptions: {
      login: '/auth/login',
      callback: '/auth/confirm',
      include: undefined,
      exclude: ['/', '/auth/*', '/invite/*', '/m/*'],
      cookieRedirect: false,
    },
  },

  colorMode: {
    classSuffix: '',
    preference: 'dark',
    fallback: 'dark',
  },

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
  },

  app: {
    head: {
      title: 'Fran SKUMS - Product Operations',
      meta: [
        { name: 'description', content: 'Fran product, inventory, fulfillment, and store-operations backend.' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap' },
      ],
    },
  },

  nitro: {
    externals: {
      // Puppeteer is dev-only (local crawling); exclude from serverless bundle
      external: ['puppeteer', 'puppeteer-core', 'chromium-bidi'],
    },
  },

  runtimeConfig: {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_KEY || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    xaiApiKey: process.env.XAI_API_KEY || '',
    // Scraper config
    scraperEnabled: process.env.SCRAPER_ENABLED !== 'false',
    scraperConcurrency: parseInt(process.env.SCRAPER_CONCURRENCY || '2'),
    scraperTimeout: parseInt(process.env.SCRAPER_TIMEOUT || '20000'),
    // x402 payment config
    x402WalletAddress: process.env.X402_WALLET_ADDRESS || '',
    x402Network: process.env.X402_NETWORK || 'base',
    x402FacilitatorUrl: process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator',
    // Queue processor API key
    queueProcessorKey: process.env.QUEUE_PROCESSOR_KEY || '',
    // Marketplace BI scheduler (falls back to QUEUE_PROCESSOR_KEY in route)
    marketplaceCronSecret: process.env.MARKETPLACE_CRON_SECRET || '',
    public: {
      appName: 'Fran SKUMS',
      x402Network: process.env.X402_NETWORK || 'base',
    },
  },
})
