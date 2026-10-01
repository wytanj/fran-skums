/**
 * Fran owns warehouse. Packlist / fill / transfer path is store → BOH → Fran WH only.
 * Loft / WorldSyntech OFS send + LOFT-SG as fill source are retired (Class C hold).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** Canonical Fran warehouse inventory_locations.code */
export const FRAN_WH_CODE = 'WH-MAIN'

/** Preferred WH→store in-transit bucket (seeded by mig 088). */
export const FRAN_WH_XFER_CODE = 'XFER-WH-STORE'

/** Legacy Loft codes kept for historical ledger rows only — never for new fill. */
export const LEGACY_LOFT_WH_CODE = 'LOFT-SG'
export const LEGACY_LOFT_XFER_CODE = 'XFER-LOFT-STORE'

export const LOFT_SEND_DISABLED_MESSAGE =
  'Fran owns WH — Loft / WorldSyntech send is disabled. Fill and transfer from Fran WH (WH-MAIN) only.'

export function loftSendDisabledError(statusCode = 410) {
  return Object.assign(new Error(LOFT_SEND_DISABLED_MESSAGE), { statusCode })
}

export async function resolveFranWhLocationId(
  client: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await client
    .from('inventory_locations')
    .select('id, code')
    .eq('workspace_id', workspaceId)
    .eq('code', FRAN_WH_CODE)
    .maybeSingle()
  return data?.id || null
}

/** Resolve WH→store transit: Fran XFER first, then generic IN-TRANSIT, then legacy Loft XFER. */
export async function resolveWhStoreTransitLocationId(
  client: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  for (const code of [FRAN_WH_XFER_CODE, 'IN-TRANSIT', LEGACY_LOFT_XFER_CODE]) {
    const { data } = await client
      .from('inventory_locations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('code', code)
      .maybeSingle()
    if (data?.id) return data.id
  }
  return null
}
