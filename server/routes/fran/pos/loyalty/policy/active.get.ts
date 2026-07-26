import { proxyLoyaltyToCrm, requirePosLoyaltyContext, resolveCrmLink } from '../../../../../utils/crmLoyaltyFacade'

export default defineEventHandler(async (event) => {
  const ctx = await requirePosLoyaltyContext(event, 'pos:read')
  const link = await resolveCrmLink(ctx.workspaceId)
  const query = getQuery(event)
  const { data } = await proxyLoyaltyToCrm(ctx.workspaceId, {
    method: 'GET',
    path: '/api/fran/loyalty/policy-versions/active',
    query: {
      workspaceId: link?.crm_workspace_id || String(query.workspaceId || ''),
      programKey: String(query.programKey || 'fran-v2'),
      format: 'pos',
      storeId: query.storeId ? String(query.storeId) : undefined,
      registerId: query.registerId ? String(query.registerId) : undefined,
    },
  })
  return data
})
