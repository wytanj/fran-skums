import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
} from '../../../utils/integrationActions'
import {
  flashHanshowByLabel,
  flashHanshowBySku,
  type HanshowCredentials,
} from '../../../../esl/hanshow-allstar'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const connectionId = String(body.connection_id || '').trim()
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'connection_id is required' })
  }

  const labelIds = Array.isArray(body.label_ids)
    ? body.label_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : []
  const skus = Array.isArray(body.skus)
    ? body.skus.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : String(body.sku || '').trim()
      ? [String(body.sku).trim()]
      : []

  if (!labelIds.length && !skus.length) {
    throw createError({ statusCode: 400, statusMessage: 'sku, skus[], or label_ids[] is required' })
  }

  const client = getServiceClient()
  const connection = await loadIntegrationConnection(event, client, connectionId, 'hanshow-allstar', 'write')
  const credential = integrationCredential(connection)
  if (!credential?.credential_data) {
    throw createError({ statusCode: 400, statusMessage: 'Hanshow connection has no credential' })
  }

  const colors = Array.isArray(body.colors) ? body.colors.map(String) : ['red']
  const flashTime = body.flash_time ?? 1200
  const flash = { colors, flashTime }

  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'flash_labels', {
    source: 'hanshow_allstar',
    label_ids: labelIds,
    skus,
  })

  try {
    const result = labelIds.length
      ? await flashHanshowByLabel(
        credential.credential_data as HanshowCredentials,
        labelIds.map(labelId => ({ labelId, flash })),
      )
      : await flashHanshowBySku(
        credential.credential_data as HanshowCredentials,
        skus.map(sku => ({ sku, flash })),
      )

    await client
      .from('integration_credentials')
      .update({ credential_data: result.credentials })
      .eq('id', credential.id)

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: {
        source: 'hanshow_allstar',
        note: 'Cloud accepted flash. Physical LED change needs a store Hanshow AP.',
      },
      itemsProcessed: labelIds.length || skus.length,
    })

    return {
      ok: true,
      wip: true,
      note: 'Cloud accepted flash. Physical LED change needs a store Hanshow AP.',
      data: result.data,
    }
  } catch (error: any) {
    const message = error?.message || 'Hanshow ESL flash failed'
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'hanshow_allstar' },
      errorMessage: message,
      itemsFailed: 1,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
