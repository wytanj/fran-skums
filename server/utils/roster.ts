/**
 * Store rostering — Nuxt/API helpers wrapping mcp/src/lib/roster.mjs
 */
import * as roster from '../../mcp/src/lib/roster.mjs'
import { getServiceClient } from './supabase'

function db() {
  return getServiceClient()
}

export function ensureDefaultZones(workspaceId: string) {
  return roster.ensureDefaultZones(workspaceId, db())
}

export function listZones(workspaceId: string, filters?: { active_only?: boolean }) {
  return roster.listZones(workspaceId, filters || {}, db())
}

export function listEmployees(workspaceId: string, filters?: Record<string, unknown>) {
  return roster.listEmployees(workspaceId, filters || {}, db())
}

export function upsertEmployee(workspaceId: string, input: Record<string, unknown>) {
  return roster.upsertEmployee(workspaceId, input, db())
}

export function importRipplingEmployees(workspaceId: string, workers: unknown[]) {
  return roster.importRipplingEmployees(workspaceId, workers, db())
}

export function listShifts(workspaceId: string, filters?: Record<string, unknown>) {
  return roster.listShifts(workspaceId, filters || {}, db())
}

export function upsertShift(workspaceId: string, input: Record<string, unknown>) {
  return roster.upsertShift(workspaceId, input, db())
}

export function cancelShift(workspaceId: string, shiftId: string) {
  return roster.cancelShift(workspaceId, shiftId, db())
}

export function getMyAssignment(
  workspaceId: string,
  opts?: {
    employee_id?: string
    pos_staff_ref?: string
    staff_ref?: string
    external_id?: string
    at?: string
  },
) {
  return roster.getMyAssignment(workspaceId, opts || {}, db())
}

export function getBoard(
  workspaceId: string,
  opts?: { date?: string; timezone?: string },
) {
  return roster.getBoard(workspaceId, opts || {}, db())
}
