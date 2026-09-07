export default defineNuxtConfig({
  runtimeConfig: {
    shippingIngestSecret: process.env.SHIPPING_INGEST_SECRET || '',
    shippingReconSecret: process.env.SHIPPING_RECON_SECRET || '',
    shippingReconEmail: process.env.SHIPPING_RECON_EMAIL || 'jeremy@heyfran.com',
  },
})
