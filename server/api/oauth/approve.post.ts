/**
 * Mints an authorization code for the signed-in employee and returns the
 * redirect back to Claude.
 *
 * The identity binding the whole design rests on happens here: the code is tied
 * to `serverSupabaseUser(event)` — the person holding this browser session — and
 * never to the workspace or the connector. There is no path through this handler
 * that issues a code without a live Fran session, which is what stops "anyone in
 * the org who clicks Connect gets the same power".
 *
 * @see server/utils/mcpOauth.ts
 */
import { serverSupabaseUser } from '#supabase/server'
import {
  mintAuthorizationCode,
  resolveMcpScopesForUser,
  resolveWorkspaceForUser,
  validateAuthorizeRequest,
} from '../../utils/mcpOauth'

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) as Record<string, any>
  const request = await validateAuthorizeRequest(event, body)

  let user: any = null
  try {
    user = await serverSupabaseUser(event)
  } catch {
    user = null
  }
  const userId = getUid(user)
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in to Fran before authorizing.' })
  }

  const db = getAdminClient()
  const ws = await resolveWorkspaceForUser(db, userId)
  if (!ws.workspaceId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This account is not a member of any Fran workspace.',
    })
  }

  // Re-check rather than trusting what the consent screen displayed — the two
  // requests are seconds apart but the check is cheap and this is the gate.
  const { scopes } = await resolveMcpScopesForUser(db, ws.workspaceId, userId)
  if (!scopes.length) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Your role has no MCP-compatible permissions in this workspace.',
    })
  }

  const code = await mintAuthorizationCode(db, {
    workspaceId: ws.workspaceId,
    userId,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    resource: request.resource,
    scope: request.scope,
  })

  const target = new URL(request.redirectUri)
  target.searchParams.set('code', code)
  if (request.state) target.searchParams.set('state', request.state)

  return { redirect_url: target.toString() }
})
