import type { AppManifest } from "../../packages/@skums-types/app-manifest"

const manifest: AppManifest = {
  id: 'shipping',
  name: 'Shipping Visualizer',
  short_description: 'Fran inbound shipment observation: timeline, gaps, Drive files, curated WhatsApp excerpts.',
  long_description: `Ops observation base for Fran shipments (not OFS/carrier rewrite).`,
  vendor: 'SKUMS Official',
  version: '1.1.0',
  industries: ['skincare', 'cosmetics'],
  provides: {
    routes: {
      ui: ['/apps/shipping', '/apps/shipping/:id'],
      api: ['/api/apps/shipping', '/api/apps/shipping/:id', '/api/apps/shipping/ingest', '/api/apps/shipping/recon-digest'],
    },
    capabilities: {
      enrichments: ['shipping_timeline', 'shipping_gap_badges'],
    },
  },
  requires: {
    core_version: '>=0.1.0',
    permissions: ['products:read'],
  },
  availability: 'all_tiers',
}

export default manifest
