import {
  testWooCommerceCredentials,
  type WooCommerceCredentials,
} from '../../../../channels/woocommerce/client'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const credentialId = String(body.credential_id || '').trim()
  if (!credentialId) {
    throw createError({ statusCode: 400, statusMessage: 'credential_id is required' })
  }

  const client = getServiceClient()
  const { data: credential, error: credentialError } = await client
    .from('integration_credentials')
    .select('id, workspace_id, node_def_id, credential_data')
    .eq('id', credentialId)
    .maybeSingle()

  if (credentialError) {
    throw createError({ statusCode: 500, statusMessage: credentialError.message })
  }
  if (!credential) {
    throw createError({ statusCode: 404, statusMessage: 'Credential not found' })
  }

  await requireWorkspaceAccess(event, client, credential.workspace_id, 'write')

  const { data: node, error: nodeError } = await client
    .from('integration_node_definitions')
    .select('slug')
    .eq('id', credential.node_def_id)
    .maybeSingle()

  if (nodeError) {
    throw createError({ statusCode: 500, statusMessage: nodeError.message })
  }
  if (node?.slug !== 'woocommerce') {
    throw createError({ statusCode: 400, statusMessage: 'Credential is not for WooCommerce' })
  }

  try {
    const result = await testWooCommerceCredentials(credential.credential_data as WooCommerceCredentials)
    await client
      .from('integration_credentials')
      .update({
        is_valid: true,
        last_tested_at: new Date().toISOString(),
        test_error: null,
      })
      .eq('id', credential.id)

    return result
  } catch (error: any) {
    const message = error?.message || 'WooCommerce connection test failed'
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
