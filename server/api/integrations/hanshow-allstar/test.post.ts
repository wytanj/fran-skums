import { loadIntegrationCredential } from '../../../utils/integrationActions'
import {
  testHanshowCredentials,
  type HanshowCredentials,
} from '../../../../esl/hanshow-allstar'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const credentialId = String(body.credential_id || '').trim()
  if (!credentialId) {
    throw createError({ statusCode: 400, statusMessage: 'credential_id is required' })
  }

  const client = getServiceClient()
  const credential = await loadIntegrationCredential(event, client, credentialId, 'hanshow-allstar', 'write')

  try {
    const result = await testHanshowCredentials(credential.credential_data as HanshowCredentials)
    await client
      .from('integration_credentials')
      .update({
        credential_data: result.credentials,
        is_valid: true,
        last_tested_at: new Date().toISOString(),
        test_error: null,
      })
      .eq('id', credential.id)

    return { ok: true, wip: true, details: result.details }
  } catch (error: any) {
    const message = error?.message || 'Hanshow All-Star connection test failed'
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
