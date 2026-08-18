# Rosters live in Fran HRM

**Decision (2026-08-14):** SKUMS does **not** own store rostering. People, zones, shifts, clock, leave, and payroll are **Fran HRM** (`../fran-hrm`). SKUMS MCP must not answer “who is on today.”

## Why

fran-hrm already has roster builder/publish, zones, staff profiles, intake, history, POS staff facade (`GET /fran/pos/staff`), and its own MCP. A second roster in SKUMS (mig 080 + `roster_*` tools) was a duplicate.

## SKUMS after this

| Surface | Status |
|---------|--------|
| `/roster` UI, sidebar | **Removed** |
| MCP `roster_*` | **Removed** |
| `GET /api/v1/roster/*` | **Removed** |
| POS `GET /fran/pos/roster/me` · `/board` | **410** `roster_moved` — point POS at HRM |
| Tables `roster_*` (mig 080) | **Left in DB** — unused, no drop |

## What to use instead

| Need | Where |
|------|--------|
| Who is on / publish roster | fran-hrm `/roster`, `/roster-builder` |
| Zones | fran-hrm `/zones` |
| Staff directory | fran-hrm `/team` |
| POS staff list | fran-hrm `GET /fran/pos/staff` |
| Claude / MCP | **fran-hrm MCP**, not SKUMS |

## POS

fran-pos should stop calling SKUMS `/fran/pos/roster/me`. Use HRM’s staff/roster APIs. Until POS is updated, SKUMS returns HTTP 410 with `error: roster_moved`.

## Do not

- Sync HRM → SKUMS roster tables
- Re-add `roster_import_rippling` on SKUMS
- Ask SKUMS MCP about shifts
