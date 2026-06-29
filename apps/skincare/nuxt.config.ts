/**
 * Skincare Intelligence — Nuxt Layer
 *
 * This layer extends the SKUMS core app with skincare-specific UI,
 * server routes, scoring engines, and reference data lookups.
 *
 * When Nuxt builds the project, files under `app/`, `components/`,
 * `composables/`, `pages/`, and `server/` in this directory are
 * merged into the main app — same auto-imports, same routing
 * behavior as if they lived at the project root.
 *
 * The layer is enabled by adding `'./apps/skincare'` to the
 * `extends` array in the root `nuxt.config.ts`.
 *
 * NOTE: this layer is structural scaffolding. Skincare code still
 * lives in its historical locations (server/api/skincare/*,
 * server/utils/skincare-scoring.ts, app/pages/integrations.vue).
 * It migrates into this layer file-by-file as Phase B progresses.
 */

export default defineNuxtConfig({
  // No layer-specific config yet — purely structural for now.
  //
  // Future additions might include:
  // - app: { head: { meta: [{ name: 'application-name', content: 'Skincare Intelligence' }] } }
  // - runtimeConfig: { skincare: { ipsBlacklistPenaltyMultiplier: 1.0 } }
  // - css: ['~/assets/css/skincare.css']
  // - imports: { dirs: ['./server/utils/scoring'] }
})
