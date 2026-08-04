/**
 * Serves the two OAuth discovery documents for the remote MCP connector.
 *
 * Middleware rather than `server/routes/.well-known/…` on purpose: a dot-prefixed
 * directory is not reliably picked up by file-based route scanners, and Claude
 * probes several path variants for the same document (bare, and with the MCP
 * path appended per RFC 9728 §3.1). One matcher covers them all with no
 * dependency on how the build globs the filesystem.
 *
 * Inert unless MCP_OAUTH_CLIENT_ID is set: with no client configured these
 * return 404, so Claude never discovers an OAuth server that cannot complete a
 * flow and the existing API-key-in-URL path keeps working untouched.
 *
 * @see server/utils/mcpOauth.ts
 */
import { defineEventHandler, getMethod, send, setResponseHeader, setResponseStatus } from 'h3'
import {
  authorizationServerMetadata,
  anyMcpOauthClient,
  protectedResourceMetadata,
} from '../utils/mcpOauth'

const PROTECTED_RESOURCE_PATHS = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
])

const AUTH_SERVER_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
])

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0].replace(/\/+$/, '') || '/'

  // Cheapest possible bail-out — this runs on every request.
  if (!path.startsWith('/.well-known/oauth-')) return

  const isProtectedResource = PROTECTED_RESOURCE_PATHS.has(path)
  const isAuthServer = AUTH_SERVER_PATHS.has(path)
  if (!isProtectedResource && !isAuthServer) return

  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  setResponseHeader(event, 'access-control-allow-headers', 'content-type, mcp-protocol-version')

  if (getMethod(event) === 'OPTIONS') {
    setResponseStatus(event, 204)
    return send(event, '')
  }

  if (!(await anyMcpOauthClient())) {
    setResponseStatus(event, 404)
    setResponseHeader(event, 'content-type', 'application/json')
    return send(
      event,
      JSON.stringify({
        error: 'oauth_not_configured',
        message:
          'This deployment has no MCP OAuth client. Use an API key: /mcp?api_key=sk_live_…',
      }),
    )
  }

  const doc = isProtectedResource
    ? protectedResourceMetadata(event)
    : await authorizationServerMetadata(event)

  setResponseStatus(event, 200)
  setResponseHeader(event, 'content-type', 'application/json')
  // Metadata is stable per deployment; let Anthropic cache it briefly.
  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  return send(event, JSON.stringify(doc))
})
