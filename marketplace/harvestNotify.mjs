/**
 * MH-9 — out-of-band harvest notifications from the local CLI.
 *
 * Posts to POST /api/internal/marketplace/harvest-event, which emits through
 * the Phase N bus server-side. Delivery logic (policy, recipients, Slack,
 * audit) stays in one place; this file only knows how to make the call.
 *
 * Deliberately best-effort: a harvest run must never fail, stall, or lose data
 * because a notification could not be sent. Every failure path logs and
 * returns a reason instead of throwing.
 *
 * Config (all optional — unset means "no pings", which is a valid setup):
 *   SKUMS_API_BASE          e.g. https://fran-skums.vercel.app
 *   MARKETPLACE_CRON_SECRET (or QUEUE_PROCESSOR_KEY)
 */

const DEFAULT_TIMEOUT_MS = 8000

/**
 * @param {{
 *   baseUrl?: string
 *   secret?: string
 *   workspaceId: string
 *   runId?: string
 *   enabled?: boolean
 *   timeoutMs?: number
 * }} cfg
 */
export function createHarvestNotifier(cfg) {
  const baseUrl = String(cfg.baseUrl || process.env.SKUMS_API_BASE || '').replace(/\/$/, '')
  const secret = String(
    cfg.secret || process.env.MARKETPLACE_CRON_SECRET || process.env.QUEUE_PROCESSOR_KEY || '',
  )
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const enabled = cfg.enabled !== false && Boolean(baseUrl && secret && cfg.workspaceId)

  let warned = false
  const warnOnce = () => {
    if (warned) return
    warned = true
    console.error(
      '[notify] disabled — set SKUMS_API_BASE + MARKETPLACE_CRON_SECRET to get blocked/recovered pings',
    )
  }

  /**
   * @param {'blocked'|'recovered'} kind
   * @param {Record<string, any>} info
   */
  async function send(kind, info = {}) {
    if (!enabled) {
      warnOnce()
      return { ok: false, skipped: true, reason: 'not_configured' }
    }

    const payload = {
      workspace_id: cfg.workspaceId,
      event: kind,
      run_id: cfg.runId || null,
      ...info,
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${baseUrl}/api/internal/marketplace/harvest-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        console.error(`[notify] ${kind} failed: HTTP ${res.status} ${String(text).slice(0, 160)}`)
        return { ok: false, reason: `http_${res.status}` }
      }
      const json = await res.json().catch(() => ({}))
      console.error(`[notify] ${kind} sent for ${info.brand_key || '?'}`)
      return { ok: true, result: json }
    } catch (e) {
      // Includes the abort case — a slow control plane must not stall a harvest.
      console.error(`[notify] ${kind} failed: ${e?.name === 'AbortError' ? 'timeout' : e?.message || e}`)
      return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'network' }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    enabled,
    blocked: (info) => send('blocked', info),
    recovered: (info) => send('recovered', info),
  }
}

/** No-op notifier for dry runs and tests. */
export function nullNotifier() {
  return {
    enabled: false,
    blocked: async () => ({ ok: false, skipped: true, reason: 'null_notifier' }),
    recovered: async () => ({ ok: false, skipped: true, reason: 'null_notifier' }),
  }
}
