/**
 * Cadence helpers for marketplace crawl seeds.
 * Pure functions — no DB I/O.
 */

/**
 * @param {string | Date} nowInput
 * @param {{
 *   schedule_kind: string
 *   timezone?: string
 *   preferred_hour?: number
 *   weekly_day?: number | null
 *   schedule_cron?: string | null
 * }} seed
 * @returns {Date | null} next run instant (UTC Date); null if manual_only
 */
export function computeNextRunAt(nowInput, seed) {
  const now = nowInput instanceof Date ? new Date(nowInput.getTime()) : new Date(nowInput)
  if (Number.isNaN(now.getTime())) {
    throw new Error('Invalid now timestamp')
  }

  const kind = seed.schedule_kind || 'daily'
  if (kind === 'manual_only') return null

  const hour = clampInt(seed.preferred_hour ?? 2, 0, 23)

  if (kind === 'daily') {
    const next = atPreferredHourUtcApprox(now, hour)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    return next
  }

  if (kind === 'weekly') {
    const targetDow = clampInt(seed.weekly_day ?? 1, 0, 6) // 0=Sun … 6=Sat; default Mon
    const next = atPreferredHourUtcApprox(now, hour)
    const dayDelta = (targetDow - next.getUTCDay() + 7) % 7
    next.setUTCDate(next.getUTCDate() + dayDelta)
    if (next <= now) next.setUTCDate(next.getUTCDate() + 7)
    return next
  }

  if (kind === 'cron') {
    // Minimal cron support: "m h * * *" and "m h * * d" only (UTC).
    // Full cron deferred; invalid → +1 day fallback.
    const parsed = parseSimpleCron(seed.schedule_cron)
    if (!parsed) {
      const fallback = new Date(now.getTime())
      fallback.setUTCDate(fallback.getUTCDate() + 1)
      fallback.setUTCHours(hour, 0, 0, 0)
      return fallback
    }
    return nextFromSimpleCron(now, parsed)
  }

  // unknown → treat as daily
  const next = atPreferredHourUtcApprox(now, hour)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

/**
 * @param {object} seed
 * @param {Date | string} nowInput
 * @returns {boolean}
 */
export function isSeedDue(seed, nowInput) {
  if (!seed || seed.enabled === false) return false
  if (seed.schedule_kind === 'manual_only') return false
  if (!seed.next_run_at) return true
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput)
  const next = new Date(seed.next_run_at)
  if (Number.isNaN(next.getTime())) return true
  return next.getTime() <= now.getTime()
}

/**
 * Build a job insert row from a due seed (no id).
 * @param {object} seed
 * @param {Date | string} [nowInput]
 */
export function buildJobFromSeed(seed, nowInput = new Date()) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput)
  return {
    workspace_id: seed.workspace_id,
    seed_id: seed.id,
    marketplace: seed.marketplace || 'shopee',
    country: seed.country || 'sg',
    crawl_type: seed.mode || 'keyword',
    target: seed.target,
    status: 'pending',
    priority: seed.priority ?? 100,
    collector_id: seed.collector_id || 'mock',
    scheduled_for: now.toISOString(),
    metadata: {
      enqueued_by: 'scheduler',
      schedule_kind: seed.schedule_kind,
    },
  }
}

/**
 * After enqueue, return patch fields for the seed.
 * @param {object} seed
 * @param {Date | string} nowInput
 */
export function seedPatchAfterEnqueue(seed, nowInput = new Date()) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput)
  const next = computeNextRunAt(now, seed)
  return {
    last_enqueued_at: now.toISOString(),
    next_run_at: next ? next.toISOString() : null,
    last_error: null,
  }
}

// ── internals ────────────────────────────────────────────────

function clampInt(n, min, max) {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, Math.trunc(v)))
}

/** Approximate preferred local hour as UTC hour for v1 (timezone full IANA later). */
function atPreferredHourUtcApprox(now, hour) {
  const d = new Date(now.getTime())
  d.setUTCHours(hour, 0, 0, 0)
  return d
}

/**
 * @param {string | null | undefined} expr
 * @returns {{ minute: number, hour: number, dow: number | null } | null}
 */
function parseSimpleCron(expr) {
  if (!expr || typeof expr !== 'string') return null
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return null
  const [m, h, , , d] = parts
  if (m === '*' || h === '*') return null
  const minute = Number(m)
  const hour = Number(h)
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null
  let dow = null
  if (d !== '*') {
    const n = Number(d)
    if (!Number.isFinite(n) || n < 0 || n > 6) return null
    dow = n
  }
  return { minute, hour, dow }
}

function nextFromSimpleCron(now, parsed) {
  const candidate = new Date(now.getTime())
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(parsed.minute)
  candidate.setUTCHours(parsed.hour)

  if (parsed.dow == null) {
    if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1)
    return candidate
  }

  for (let i = 0; i < 8; i++) {
    const d = new Date(candidate.getTime())
    d.setUTCDate(candidate.getUTCDate() + i)
    d.setUTCHours(parsed.hour, parsed.minute, 0, 0)
    if (d.getUTCDay() === parsed.dow && d > now) return d
  }
  candidate.setUTCDate(candidate.getUTCDate() + 7)
  return candidate
}
