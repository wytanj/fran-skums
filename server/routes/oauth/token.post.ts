/**
 * OAuth token endpoint for the remote MCP connector.
 * POST /oauth/token — grant_type = authorization_code | refresh_token
 *
 * Anthropic sends both the initial exchange and refreshes as
 * application/x-www-form-urlencoded, and times out after 10s (30s for
 * refreshes), so this path stays free of slow work.
 *
 * @see server/utils/mcpOauth.ts
 */
import {
  OauthError,
  exchangeAuthorizationCode,
  mcpOauthClient,
  refreshAccessToken,
  touchMcpOauthClient,
  verifyClientSecretHash,
} from '../../utils/mcpOauth'

type TokenErrorBody = { error: string; error_description?: string }

function fail(event: any, status: number, body: TokenErrorBody) {
  setResponseStatus(event, status)
  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Cache-Control', 'no-store')
  return body
}

/** Pull client credentials from HTTP Basic or the form body (RFC 6749 §2.3.1). */
function readClientCredentials(event: any, body: Record<string, any>) {
  const authHeader = String(getHeader(event, 'authorization') || '')
  const basic = authHeader.match(/^Basic\s+(.+)$/i)
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1].trim(), 'base64').toString('utf8')
      const sep = decoded.indexOf(':')
      if (sep > -1) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, sep)),
          clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
        }
      }
    } catch {
      /* fall through to form fields */
    }
  }
  return {
    clientId: body.client_id ? String(body.client_id) : '',
    clientSecret: body.client_secret ? String(body.client_secret) : '',
  }
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const db = getAdminClient()
  const client = await mcpOauthClient(db)
  if (!client) {
    return fail(event, 503, {
      error: 'temporarily_unavailable',
      error_description: 'MCP OAuth is not configured on this deployment.',
    })
  }

  let body: Record<string, any>
  try {
    const parsed = await readBody(event)
    if (typeof parsed === 'string') {
      body = Object.fromEntries(new URLSearchParams(parsed))
    } else {
      body = (parsed || {}) as Record<string, any>
    }
  } catch {
    return fail(event, 400, {
      error: 'invalid_request',
      error_description: 'Body must be application/x-www-form-urlencoded.',
    })
  }

  const creds = readClientCredentials(event, body)
  if (creds.clientId !== client.clientId) {
    return fail(event, 401, {
      error: 'invalid_client',
      error_description: 'Unknown client_id.',
    })
  }
  if (!verifyClientSecretHash(creds.clientSecret, client.clientSecretHash)) {
    return fail(event, 401, {
      error: 'invalid_client',
      error_description: 'client_secret does not match.',
    })
  }

  touchMcpOauthClient(db, client)

  const grantType = String(body.grant_type || '')
  const resource = body.resource ? String(body.resource) : null

  try {
    if (grantType === 'authorization_code') {
      const code = String(body.code || '')
      const redirectUri = String(body.redirect_uri || '')
      const codeVerifier = String(body.code_verifier || '')
      if (!code || !redirectUri || !codeVerifier) {
        return fail(event, 400, {
          error: 'invalid_request',
          error_description: 'code, redirect_uri and code_verifier are required.',
        })
      }

      const grant = await exchangeAuthorizationCode(db, {
        code,
        clientId: creds.clientId,
        redirectUri,
        codeVerifier,
        resource,
      })

      setHeader(event, 'Content-Type', 'application/json')
      return {
        access_token: grant.accessToken,
        token_type: 'Bearer',
        expires_in: grant.expiresInSeconds,
        refresh_token: grant.refreshToken || undefined,
        scope: grant.scope,
      }
    }

    if (grantType === 'refresh_token') {
      const refreshToken = String(body.refresh_token || '')
      if (!refreshToken) {
        return fail(event, 400, {
          error: 'invalid_request',
          error_description: 'refresh_token is required.',
        })
      }

      const grant = await refreshAccessToken(db, {
        refreshToken,
        clientId: creds.clientId,
        resource,
      })

      setHeader(event, 'Content-Type', 'application/json')
      return {
        access_token: grant.accessToken,
        token_type: 'Bearer',
        expires_in: grant.expiresInSeconds,
        // Rotated on every use, so always return the replacement in the same
        // response that invalidated the old one.
        refresh_token: grant.refreshToken || undefined,
        scope: grant.scope,
      }
    }

    return fail(event, 400, {
      error: 'unsupported_grant_type',
      error_description:
        'Supported grants: authorization_code, refresh_token. client_credentials is not offered — every connection is tied to a signed-in Fran user.',
    })
  } catch (e: any) {
    if (e instanceof OauthError) {
      return fail(event, e.status, { error: e.code, error_description: e.message })
    }
    return fail(event, 500, {
      error: 'server_error',
      error_description: e?.message || 'Token exchange failed.',
    })
  }
})
