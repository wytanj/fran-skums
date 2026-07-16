/**
 * Pure schedule helpers for agentic report subscriptions (track K / Rpt-3).
 * No I/O — safe for server + MCP + tests.
 */

/**
 * Format a Date in a timezone as YYYY-MM-DD (en-CA).
 * @param {Date} date
 * @param {string} timeZone
 */
export function calendarDateInTz(date, timeZone = 'Asia/Singapore') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/**
 * ISO week key in timezone: YYYY-Www
 * @param {Date} date
 * @param {string} timeZone
 */
export function isoWeekKeyInTz(date, timeZone = 'Asia/Singapore') {
  // Approximate: use UTC date parts shifted via formatter
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const y = Number(parts.find((p) => p.type === 'year')?.value)
  const m = Number(parts.find((p) => p.type === 'month')?.value)
  const d = Number(parts.find((p) => p.type === 'day')?.value)
  const local = new Date(Date.UTC(y, m - 1, d))
  // ISO week
  const dayNum = local.getUTCDay() || 7
  local.setUTCDate(local.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(local.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((local - yearStart) / 86400000 + 1) / 7)
  return `${local.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Calendar month key YYYY-MM in timezone.
 * @param {Date} date
 * @param {string} timeZone
 */
export function monthKeyInTz(date, timeZone = 'Asia/Singapore') {
  return calendarDateInTz(date, timeZone).slice(0, 7)
}

/**
 * Whether an enabled subscription is due for a cron tick.
 * manual → never; no prior run → due.
 *
 * @param {{ schedule?: string, timezone?: string, enabled?: boolean }} sub
 * @param {string | null | undefined} lastFinishedAt ISO timestamp of last completed/skipped run
 * @param {Date} [now]
 */
export function isSubscriptionDue(sub, lastFinishedAt, now = new Date()) {
  if (sub && sub.enabled === false) return false
  const schedule = String(sub?.schedule || 'weekly').toLowerCase()
  if (schedule === 'manual') return false

  const tz = sub?.timezone || 'Asia/Singapore'
  if (!lastFinishedAt) return true

  const last = new Date(lastFinishedAt)
  if (Number.isNaN(last.getTime())) return true

  if (schedule === 'hourly') {
    return now.getTime() - last.getTime() >= 60 * 60 * 1000
  }
  if (schedule === 'daily') {
    return calendarDateInTz(now, tz) !== calendarDateInTz(last, tz)
  }
  if (schedule === 'weekly') {
    return isoWeekKeyInTz(now, tz) !== isoWeekKeyInTz(last, tz)
  }
  if (schedule === 'monthly') {
    return monthKeyInTz(now, tz) !== monthKeyInTz(last, tz)
  }
  // unknown schedule → don't auto-run
  return false
}
