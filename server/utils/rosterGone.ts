/**
 * Store rostering moved to Fran HRM (fran-hrm). SKUMS no longer serves it.
 */
export function rosterMovedPayload() {
  return {
    error: 'roster_moved',
    message:
      'Store roster, staff, zones, and shifts live in Fran HRM. Use the fran-hrm app and its MCP — not SKUMS.',
    hrm: 'fran-hrm',
  }
}
