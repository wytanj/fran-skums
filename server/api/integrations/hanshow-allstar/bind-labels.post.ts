import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
} from '../../../utils/integrationActions'
import {
  bindHanshowLabels,
  unbindHanshowLabels,
  type HanshowCredentials,
} from '../../../../esl/hanshow-allstar'

function parseLinks(body: any) {
  const raw = Array.isArray(body?.links) ? body.links : []
  return raw
    .map((row: any) => ({
      labelId: String(row?.labelId || row?.label_id || '').trim(),
      sku: String(row?.sku || '').trim() || undefined,
      position: row?.position == null ? undefined : Number(row.position),
    }))
    .filter((row: { labelId: string }) => row.labelId)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const connectionId = String(body.connection_id || '').trim()
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'connection_id is required' })
  }

  const unlink = body.unbind === true || body.action === 'unbind'
  const links = parseLinks(body)
  if (!links.length) {
    throw createError({ statusCode: 400, statusMessage: 'links[] with labelId is required' })
  }

  const client = getServiceClient()
  const connection = await loadIntegrationConnection(event, client, connectionId, 'hanshow-allstar', 'write')
  const credential = integrationCredential(connection)
  if (!credential?.credential_data) {
    throw createError({ statusCode: 400, statusMessage: 'Hanshow connection has no credential' })
  }

  const actionKey = unlink ? 'unbind_labels' : 'bind_labels'
  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, actionKey, {
    source: 'hanshow_allstar',
    links,
  })

  try {
    const result = unlink
      ? await unbindHanshowLabels(credential.credential_data as HanshowCredentials, links)
      : await bindHanshowLabels(credential.credential_data as HanshowCredentials, links)

    await client
      .from('integration_credentials')
      .update({ credential_data: result.credentials })
      .eq('id', credential.id)

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: { source: 'hanshow_allstar', action: actionKey },
      itemsProcessed: links.length,
    })

    return { ok: true, wip: true, action: actionKey, data: result.data }
  } catch (error: any) {
    const message = error?.message || 'Hanshow ESL bind failed'
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'hanshow_allstar' },
      errorMessage: message,
      itemsFailed: links.length,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
