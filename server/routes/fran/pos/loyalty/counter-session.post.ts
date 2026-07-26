import { proxyLoyaltyToCrm, requirePosLoyaltyContext } from '../../../../utils/crmLoyaltyFacade'

export default defineEventHandler(async (event) => {
  const ctx = await requirePosLoyaltyContext(event, 'pos:read')
  const body = await readBody(event)
  const { data } = await proxyLoyaltyToCrm(ctx.workspaceId, {
    method: 'POST',
    path: '/fran/pos/counter-session',
    body,
    injectWorkspace: true,
  })
  return data
})
