import { getCrawlLogs } from '../../utils/crawl-logger'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const jobId = query.job_id as string
  const sinceIndex = parseInt(query.since as string || '0', 10)

  if (!jobId) {
    throw createError({ statusCode: 400, message: 'job_id required' })
  }

  return getCrawlLogs(jobId, sinceIndex)
})
