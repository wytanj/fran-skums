/**
 * POS readiness: SKUMS key valid + optional CRM loyalty link status.
 * Auth: workspace API key with pos:read.
 */
import { buildPosCapabilities } from '../../../utils/crmLoyaltyFacade'

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event, 'pos:read')
  return buildPosCapabilities(ctx)
})
