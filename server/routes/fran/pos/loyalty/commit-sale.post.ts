import { proxyLoyaltyToCrm, requirePosLoyaltyContext } from '../../../../utils/crmLoyaltyFacade'

export default defineEventHandler(async (event) => {
  const ctx = await requirePosLoyaltyContext(event, 'pos:write')
  const body = await readBody(event)
  const { data } = await proxyLoyaltyToCrm(ctx.workspaceId, {
    method: 'POST',
    path: '/fran/pos/loyalty/commit-sale',
    body,
    injectWorkspace: true,
  })
  return data
})
