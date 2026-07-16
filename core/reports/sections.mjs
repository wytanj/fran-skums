/**
 * Report section runners (track K).
 * Rpt-6 replaces stubs with real handlers. Suggest-only always.
 */

/**
 * Stub section runner — Rpt-6 will replace with real handlers.
 * Always suggest-only; never mutates stock or approves.
 * @param {string[]} sections
 */
export function runStubSections(sections) {
  const list = Array.isArray(sections) ? sections : []
  const out = list.map((id) => ({
    id,
    status: 'stub',
    summary: `Section \`${id}\` is registered but not yet implemented (Rpt-6).`,
    data: { stub: true },
  }))
  const lines = [
    '## Report run (stub sections)',
    '',
    '_Suggest ≠ execute. No stock, approve, Loft, or FOB side effects._',
    '',
    ...out.map((s) => `- **${s.id}**: ${s.summary}`),
  ]
  return { sections: out, markdown: lines.join('\n') }
}
