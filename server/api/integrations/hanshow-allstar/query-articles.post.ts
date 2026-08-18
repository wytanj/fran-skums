import {
  completeIntegrationExecution,
  integrationCredential,
  loadIntegrationConnection,
  startIntegrationExecution,
} from '../../../utils/integrationActions'
import {
  queryHanshowArticlesByIds,
  queryHanshowArticlesPage,
  type HanshowCredentials,
} from '../../../../esl/hanshow-allstar'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const connectionId = String(body.connection_id || '').trim()
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'connection_id is required' })
  }

  const client = getServiceClient()
  const connection = await loadIntegrationConnection(event, client, connectionId, 'hanshow-allstar', 'write')
  const credential = integrationCredential(connection)
  if (!credential?.credential_data) {
    throw createError({ statusCode: 400, statusMessage: 'Hanshow connection has no credential' })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : String(body.ids || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean)

  const startedAt = Date.now()
  const executionId = await startIntegrationExecution(client, connection, 'query_articles', {
    source: 'hanshow_allstar',
    ids,
    page_num: body.page_num,
    page_size: body.page_size,
  })

  try {
    const result = ids.length
      ? await queryHanshowArticlesByIds(credential.credential_data as HanshowCredentials, ids)
      : await queryHanshowArticlesPage(credential.credential_data as HanshowCredentials, {
        pageNum: body.page_num,
        pageSize: body.page_size,
        indexes: body.indexes ? String(body.indexes) : undefined,
        matchRule: body.match_rule === 'ALL' || body.match_rule === 'RIGHT' ? body.match_rule : undefined,
      })

    const articles = 'articles' in result
      ? result.articles
      : (result.page.pageData || [])
    const count = 'page' in result
      ? (result.page.count ?? articles.length)
      : articles.length

    await client
      .from('integration_credentials')
      .update({ credential_data: result.credentials })
      .eq('id', credential.id)

    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'success',
      outputData: { source: 'hanshow_allstar', count },
      itemsProcessed: articles.length,
    })

    return {
      ok: true,
      wip: true,
      connection_id: connection.id,
      count,
      articles: articles.slice(0, 50),
      page: 'page' in result ? result.page : undefined,
    }
  } catch (error: any) {
    const message = error?.message || 'Hanshow article query failed'
    await completeIntegrationExecution(client, executionId, startedAt, {
      status: 'error',
      outputData: { source: 'hanshow_allstar' },
      errorMessage: message,
      itemsFailed: 1,
    })
    throw createError({ statusCode: 502, statusMessage: message })
  }
})
