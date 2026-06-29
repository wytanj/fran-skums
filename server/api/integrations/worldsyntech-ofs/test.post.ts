import {
  loadIntegrationCredential,
} from '../../../utils/integrationActions'
import {
  testWorldsyntechCredentials,
  type WorldsyntechCredentials,
} from '../../../../fulfillment/worldsyntech-ofs/client'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const credentialId = String(body.credential_id || '').trim()
  if (!credentialId) {
    throw createError({ statusCode: 400, statusMessage: 'credential_id is required' })
  }

  const client = getServiceClient()
  const credential = await loadIntegrationCredential(event, client, credentialId, 'worldsyntech-ofs', 'write')

  try {
    const result = await testWorldsyntechCredentials(credential.credential_data as WorldsyntechCredentials)
    await client
      .from('integration_credentials')
      .update({
        credential_data: result.credentials,
        is_valid: true,
        last_tested_at: new Date().toISOString(),
        test_error: null,
      })
      .eq('id', credential.id)

    return { ok: true, details: result.details }
  } catch (error: any) {
    const message = error?.message || 'WorldSyntech/OFS connection test failed'
    await client
      .from('integration_credentials')
      .update({
        is_valid: false,
        last_tested_at: new Date().toISOString(),
        test_error: message,
      })
      .eq('id', credential.id)

    throw createError({ statusCode: 502, statusMessage: message })
  }
})
