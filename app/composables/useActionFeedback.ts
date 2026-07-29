/**
 * Shared feedback for user-initiated actions.
 *
 * Replaces the six per-page `showOk` / `showErr` implementations, which each
 * rendered a banner at the top of their own page. Because `<main>` is the
 * scroll container, that banner scrolled out of view — so submitting a form
 * near the bottom of a long page produced no visible result at all.
 *
 * Three things this guarantees that the old pattern did not:
 *   1. Toasts render in a fixed host, so they are visible regardless of scroll.
 *   2. Errors clear themselves (the old `showErr` never did — stale failures
 *      stayed on screen indefinitely and read as current).
 *   3. Every action can expose a pending state, so a click always changes
 *      something on screen immediately.
 */

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  /** Optional second line — e.g. server detail behind a short summary. */
  detail?: string | null
  createdAt: number
}

/** Success is transient; errors linger long enough to read and copy. */
const TTL: Record<ToastKind, number> = {
  success: 4000,
  info: 6000,
  error: 12000,
}

let seq = 0

/**
 * Pull a human-usable message out of whatever the caller threw.
 *
 * Covers the shapes actually in use across this app: `$fetch` errors
 * (`data.statusMessage` / `data.message`), Supabase client errors (`message`),
 * and plain `Error`. Nitro masks 5xx `statusMessage` as "Server Error", so we
 * detect that and say something the user can act on instead.
 */
export function extractErrorMessage(err: unknown): { message: string; detail: string | null } {
  const e = err as any
  const status: number | undefined = e?.statusCode || e?.status || e?.response?.status

  const raw =
    e?.data?.statusMessage
    || e?.data?.message
    || e?.data?.error
    || e?.statusMessage
    || e?.message
    || (typeof err === 'string' ? err : '')

  const text = String(raw || '').trim()
  const masked = !text || /^server error$/i.test(text) || /^internal server error$/i.test(text)

  if (masked && status && status >= 500) {
    return {
      message: 'The server failed to complete this action.',
      detail: `HTTP ${status} — the details were not sent to the browser. Check the server logs for the underlying error.`,
    }
  }
  if (status === 401) {
    return { message: 'Your session has expired. Sign in again to continue.', detail: text || null }
  }
  if (status === 403) {
    return {
      message: text || 'You do not have permission to do this.',
      detail: text ? null : 'This action requires a scope your account is missing.',
    }
  }
  if (!text) return { message: 'Something went wrong.', detail: status ? `HTTP ${status}` : null }
  return { message: text, detail: null }
}

export function useActionFeedback() {
  const toasts = useState<Toast[]>('action-feedback-toasts', () => [])
  // Keyed so a specific row/button can show its own spinner, not just the page.
  const pending = useState<Record<string, boolean>>('action-feedback-pending', () => ({}))

  function dismiss(id: string) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function push(kind: ToastKind, message: string, detail?: string | null) {
    const id = `t${Date.now().toString(36)}-${seq++}`
    toasts.value = [...toasts.value, { id, kind, message, detail: detail ?? null, createdAt: Date.now() }]
    if (import.meta.client) {
      setTimeout(() => dismiss(id), TTL[kind])
    }
    return id
  }

  const notify = {
    success: (message: string, detail?: string | null) => push('success', message, detail),
    info: (message: string, detail?: string | null) => push('info', message, detail),
    error: (err: unknown, fallback?: string) => {
      const { message, detail } = extractErrorMessage(err)
      // Prefer extracted message; use fallback when extraction is empty/generic
      const primary =
        fallback && (!message || /^something went wrong/i.test(message) || /^the server failed/i.test(message))
          ? fallback
          : message
      return push('error', primary || fallback || 'Something went wrong.', detail)
    },
  }

  const isPending = (key: string) => Boolean(pending.value[key])
  const anyPending = computed(() => Object.values(pending.value).some(Boolean))

  function setPending(key: string, value: boolean) {
    pending.value = { ...pending.value, [key]: value }
    if (!value) {
      const next = { ...pending.value }
      delete next[key]
      pending.value = next
    }
  }

  /**
   * Run an action with pending state and automatic success/error feedback.
   *
   * Returns the action's value on success and `undefined` on failure, so
   * callers can branch without a try/catch:
   *
   *   const res = await runAction('request.create', () => $fetch(...), {
   *     success: 'Request submitted to HQ queue',
   *   })
   *   if (!res) return
   *
   * @param key      Unique per button/row, e.g. `request.decide.${id}`
   * @param fn       The async work
   * @param opts     `success` message (omit to stay silent on success)
   */
  async function runAction<T>(
    key: string,
    fn: () => Promise<T>,
    opts: { success?: string | null; successDetail?: string | null; errorFallback?: string } = {},
  ): Promise<T | undefined> {
    if (isPending(key)) return undefined // double-click guard
    setPending(key, true)
    try {
      const result = await fn()
      if (opts.success) notify.success(opts.success, opts.successDetail ?? null)
      return result
    } catch (err) {
      notify.error(err, opts.errorFallback)
      return undefined
    } finally {
      setPending(key, false)
    }
  }

  return { toasts, notify, dismiss, isPending, anyPending, setPending, runAction, extractErrorMessage }
}
