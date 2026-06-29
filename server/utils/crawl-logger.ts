// In-memory crawl log buffer — stores recent log lines per job
// Accessible via /api/skincare/logs?job_id=xxx

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
}

const logBuffers = new Map<string, LogEntry[]>()
const MAX_LINES_PER_JOB = 500
const MAX_JOBS = 10

export function crawlLog(jobId: string, level: 'info' | 'warn' | 'error', message: string) {
  if (!logBuffers.has(jobId)) {
    // Evict oldest job if we're at max
    if (logBuffers.size >= MAX_JOBS) {
      const oldest = logBuffers.keys().next().value
      if (oldest) logBuffers.delete(oldest)
    }
    logBuffers.set(jobId, [])
  }

  const buffer = logBuffers.get(jobId)!
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  }

  buffer.push(entry)

  // Trim if too long
  if (buffer.length > MAX_LINES_PER_JOB) {
    buffer.splice(0, buffer.length - MAX_LINES_PER_JOB)
  }

  // Also log to console
  const prefix = `[crawl/${jobId.slice(0, 8)}]`
  if (level === 'error') console.error(prefix, message)
  else if (level === 'warn') console.warn(prefix, message)
  else console.log(prefix, message)
}

export function getCrawlLogs(jobId: string, sinceIndex: number = 0): { logs: LogEntry[]; nextIndex: number } {
  const buffer = logBuffers.get(jobId) ?? []
  const logs = buffer.slice(sinceIndex)
  return { logs, nextIndex: buffer.length }
}

export function getAllJobIds(): string[] {
  return Array.from(logBuffers.keys())
}
