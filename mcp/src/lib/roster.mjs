/**
 * Store rostering — employees, zones, hourly shifts (MCP + pure Supabase).
 * Does not call Rippling live; import accepts Rippling-shaped rows.
 *
 * Pass `db` (Supabase client) optionally; defaults to MCP getDb().
 */
import { getDb as mcpGetDb } from '../context.mjs'

function resolveDb(db) {
  return db || mcpGetDb()
}

const DEFAULT_ZONES = [
  { code: 'zone_1', name: 'Zone 1', sort_order: 10 },
  { code: 'zone_2', name: 'Zone 2', sort_order: 20 },
  { code: 'zone_3', name: 'Zone 3', sort_order: 30 },
  { code: 'cashier', name: 'Cashier', sort_order: 40 },
  { code: 'back_of_house', name: 'Back of House', sort_order: 50 },
]

const SHIFT_STATUSES = new Set(['draft', 'scheduled', 'published', 'cancelled', 'completed'])
const EMPLOYMENT = new Set(['active', 'inactive', 'terminated', 'leave'])
const SOURCES = new Set(['manual', 'rippling', 'import', 'other'])

function slugRole(v) {
  const s = String(v || 'associate')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return s || 'associate'
}

function hourFloorIso(input) {
  const d = input ? new Date(input) : new Date()
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime: ${input}`)
  d.setMinutes(0, 0, 0)
  return d.toISOString()
}

function hourCeilIso(input) {
  const d = input ? new Date(input) : new Date()
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid datetime: ${input}`)
  if (d.getMinutes() || d.getSeconds() || d.getMilliseconds()) {
    d.setHours(d.getHours() + 1, 0, 0, 0)
  } else {
    d.setMinutes(0, 0, 0)
  }
  return d.toISOString()
}

export async function ensureDefaultZones(workspaceId, dbIn) {
  const db = resolveDb(dbIn)
  const rows = DEFAULT_ZONES.map((z) => ({
    workspace_id: workspaceId,
    code: z.code,
    name: z.name,
    sort_order: z.sort_order,
    is_active: true,
  }))
  const { data, error } = await db
    .from('roster_zones')
    .upsert(rows, { onConflict: 'workspace_id,code' })
    .select('*')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function listZones(workspaceId, { active_only = true } = {}, dbIn) {
  const db = resolveDb(dbIn)
  let q = db
    .from('roster_zones')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: true })
  if (active_only) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  if (!(data || []).length) {
    return ensureDefaultZones(workspaceId, db)
  }
  return data
}

export async function listEmployees(workspaceId, filters = {}, dbIn) {
  const db = resolveDb(dbIn)
  let q = db
    .from('roster_employees')
    .select('*, default_zone:roster_zones!roster_employees_default_zone_id_fkey(id, code, name)')
    .eq('workspace_id', workspaceId)
    .order('display_name', { ascending: true })
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500))
  if (filters.active_only !== false) q = q.eq('is_active', true)
  if (filters.source_provider) q = q.eq('source_provider', filters.source_provider)
  if (filters.employment_status) q = q.eq('employment_status', filters.employment_status)
  if (filters.q) q = q.ilike('display_name', `%${String(filters.q).trim()}%`)
  const { data, error } = await q
  if (error) {
    // fallback without join if FK name differs
    let q2 = db
      .from('roster_employees')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('display_name', { ascending: true })
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500))
    if (filters.active_only !== false) q2 = q2.eq('is_active', true)
    const res = await q2
    if (res.error) throw new Error(res.error.message)
    return res.data ?? []
  }
  return data ?? []
}

export async function upsertEmployee(workspaceId, input = {}, dbIn) {
  const db = resolveDb(dbIn)
  const display_name = String(input.display_name || input.name || '').trim()
  if (!display_name) throw new Error('display_name is required')

  const source_provider = SOURCES.has(String(input.source_provider || 'manual'))
    ? String(input.source_provider || 'manual')
    : 'manual'
  const employment_status = EMPLOYMENT.has(String(input.employment_status || 'active'))
    ? String(input.employment_status || 'active')
    : 'active'

  const row = {
    workspace_id: workspaceId,
    display_name,
    email: input.email ? String(input.email).trim() : null,
    phone: input.phone ? String(input.phone).trim() : null,
    role_label: slugRole(input.role_label || input.role || 'associate'),
    employment_status,
    source_provider,
    external_id: input.external_id ? String(input.external_id).trim() : null,
    pos_staff_ref: input.pos_staff_ref ? String(input.pos_staff_ref).trim() : null,
    default_zone_id: input.default_zone_id || null,
    is_active: input.is_active !== false,
    metadata:
      input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? input.metadata
        : {},
  }

  if (input.id) {
    const { data, error } = await db
      .from('roster_employees')
      .update(row)
      .eq('id', input.id)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  if (row.external_id) {
    const { data: existing } = await db
      .from('roster_employees')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('source_provider', source_provider)
      .eq('external_id', row.external_id)
      .maybeSingle()
    if (existing?.id) {
      const { data, error } = await db
        .from('roster_employees')
        .update({ ...row, synced_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data
    }
  }

  if (source_provider === 'rippling') {
    row.synced_at = new Date().toISOString()
  }

  const { data, error } = await db.from('roster_employees').insert(row).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Import Rippling-shaped (or simple) worker rows.
 * Expected fields: id|external_id, name|display_name, email, phone, role, employment_status
 */
export async function importRipplingEmployees(workspaceId, workers = [], dbIn) {
  if (!Array.isArray(workers) || !workers.length) {
    throw new Error('workers array is required')
  }
  const db = resolveDb(dbIn)
  const results = []
  for (const w of workers) {
    const external_id = String(
      w.id || w.external_id || w.worker_id || w.employee_id || w.uuid || '',
    ).trim()
    const display_name = String(
      w.display_name || w.name || w.full_name || [w.first_name, w.last_name].filter(Boolean).join(' '),
    ).trim()
    if (!display_name) continue
    const emp = await upsertEmployee(
      workspaceId,
      {
        display_name,
        email: w.email || w.work_email || null,
        phone: w.phone || w.mobile || null,
        role_label: w.role || w.role_label || w.title || 'associate',
        employment_status: w.employment_status || (w.active === false ? 'inactive' : 'active'),
        source_provider: 'rippling',
        external_id: external_id || `rippling:${display_name.toLowerCase().replace(/\s+/g, '-')}`,
        pos_staff_ref: w.pos_staff_ref || null,
        metadata: {
          rippling: {
            department: w.department || w.department_name || null,
            title: w.title || null,
            raw_keys: Object.keys(w).slice(0, 40),
          },
        },
      },
      db,
    )
    results.push(emp)
  }
  return { imported: results.length, employees: results }
}

export async function listShifts(workspaceId, filters = {}, dbIn) {
  const db = resolveDb(dbIn)
  const from = filters.from ? new Date(filters.from).toISOString() : null
  const to = filters.to ? new Date(filters.to).toISOString() : null

  let q = db
    .from('roster_shifts')
    .select(
      `
      *,
      employee:roster_employees(id, display_name, email, role_label, pos_staff_ref, source_provider),
      zone:roster_zones(id, code, name)
    `,
    )
    .eq('workspace_id', workspaceId)
    .order('starts_at', { ascending: true })
    .limit(Math.min(Math.max(filters.limit ?? 200, 1), 500))

  if (from) q = q.gte('starts_at', from)
  if (to) q = q.lt('starts_at', to)
  if (filters.employee_id) q = q.eq('employee_id', filters.employee_id)
  if (filters.zone_id) q = q.eq('zone_id', filters.zone_id)
  if (filters.status) q = q.eq('status', filters.status)
  else q = q.neq('status', 'cancelled')

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function upsertShift(workspaceId, input = {}, dbIn) {
  const db = resolveDb(dbIn)
  const employee_id = String(input.employee_id || '').trim()
  const zone_id = String(input.zone_id || '').trim()
  if (!employee_id) throw new Error('employee_id is required')
  if (!zone_id) throw new Error('zone_id is required')

  const starts_at = hourFloorIso(input.starts_at)
  let ends_at = input.ends_at ? hourCeilIso(input.ends_at) : null
  if (!ends_at && input.hours) {
    const start = new Date(starts_at)
    start.setHours(start.getHours() + Math.max(1, Number(input.hours) || 1))
    ends_at = start.toISOString()
  }
  if (!ends_at) throw new Error('ends_at or hours is required')
  if (new Date(ends_at) <= new Date(starts_at)) {
    throw new Error('ends_at must be after starts_at')
  }

  const status = SHIFT_STATUSES.has(String(input.status || 'scheduled'))
    ? String(input.status || 'scheduled')
    : 'scheduled'

  const row = {
    workspace_id: workspaceId,
    employee_id,
    zone_id,
    pos_location_id: input.pos_location_id || null,
    starts_at,
    ends_at,
    status,
    notes: input.notes ? String(input.notes).slice(0, 2000) : null,
    metadata:
      input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? input.metadata
        : {},
  }

  if (input.id) {
    const { data, error } = await db
      .from('roster_shifts')
      .update(row)
      .eq('id', input.id)
      .eq('workspace_id', workspaceId)
      .select(
        `*, employee:roster_employees(id, display_name), zone:roster_zones(id, code, name)`,
      )
      .single()
    if (error) throw new Error(error.message)
    return data
  }

  const { data, error } = await db
    .from('roster_shifts')
    .insert(row)
    .select(`*, employee:roster_employees(id, display_name), zone:roster_zones(id, code, name)`)
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function cancelShift(workspaceId, shiftId, dbIn) {
  const db = resolveDb(dbIn)
  const { data, error } = await db
    .from('roster_shifts')
    .update({ status: 'cancelled' })
    .eq('id', shiftId)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Current zone assignment for a POS staff member (or employee id).
 */
export async function getMyAssignment(workspaceId, opts = {}, dbIn) {
  const db = resolveDb(dbIn)
  const at = opts.at ? new Date(opts.at) : new Date()
  if (Number.isNaN(at.getTime())) throw new Error('Invalid at timestamp')
  const atIso = at.toISOString()

  let employee = null
  if (opts.employee_id) {
    const { data } = await db
      .from('roster_employees')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', opts.employee_id)
      .maybeSingle()
    employee = data
  } else if (opts.pos_staff_ref || opts.staff_ref) {
    const ref = String(opts.pos_staff_ref || opts.staff_ref).trim()
    const { data } = await db
      .from('roster_employees')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('pos_staff_ref', ref)
      .maybeSingle()
    employee = data
  } else if (opts.external_id) {
    const { data } = await db
      .from('roster_employees')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('external_id', String(opts.external_id).trim())
      .maybeSingle()
    employee = data
  }

  if (!employee) {
    return {
      at: atIso,
      employee: null,
      shift: null,
      zone: null,
      note: 'No roster employee matched pos_staff_ref / employee_id',
    }
  }

  const { data: shifts, error } = await db
    .from('roster_shifts')
    .select(`*, zone:roster_zones(id, code, name)`)
    .eq('workspace_id', workspaceId)
    .eq('employee_id', employee.id)
    .lte('starts_at', atIso)
    .gt('ends_at', atIso)
    .in('status', ['scheduled', 'published', 'draft'])
    .order('starts_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)

  const shift = shifts?.[0] || null
  let zone = shift?.zone || null

  if (!zone && employee.default_zone_id) {
    const { data: z } = await db
      .from('roster_zones')
      .select('id, code, name')
      .eq('id', employee.default_zone_id)
      .maybeSingle()
    zone = z
  }

  return {
    at: atIso,
    employee: {
      id: employee.id,
      display_name: employee.display_name,
      role_label: employee.role_label,
      pos_staff_ref: employee.pos_staff_ref,
      source_provider: employee.source_provider,
    },
    shift: shift
      ? {
          id: shift.id,
          starts_at: shift.starts_at,
          ends_at: shift.ends_at,
          status: shift.status,
          notes: shift.notes,
        }
      : null,
    zone: zone
      ? {
          id: zone.id,
          code: zone.code,
          name: zone.name,
          source: shift ? 'shift' : 'default',
        }
      : null,
    note: shift
      ? 'On shift — zone from current roster assignment'
      : zone
        ? 'No active shift hour — showing default zone'
        : 'No shift or default zone assigned',
  }
}

/**
 * Day board: shifts grouped by zone for a calendar date (local SGT default).
 */
export async function getBoard(workspaceId, { date, timezone = 'Asia/Singapore' } = {}, dbIn) {
  const db = resolveDb(dbIn)
  // Interpret date as SGT calendar day → UTC window
  const day = date || new Date().toLocaleDateString('en-CA', { timeZone: timezone })
  const from = new Date(`${day}T00:00:00+08:00`).toISOString()
  const to = new Date(`${day}T23:59:59.999+08:00`).toISOString()
  // Expand window slightly for overnight shifts starting previous evening
  const fromWide = new Date(new Date(from).getTime() - 12 * 3600 * 1000).toISOString()
  const toWide = new Date(new Date(to).getTime() + 12 * 3600 * 1000).toISOString()

  const zones = await listZones(workspaceId, {}, db)
  const shifts = await listShifts(
    workspaceId,
    {
      from: fromWide,
      to: toWide,
      limit: 500,
    },
    db,
  )

  // Keep shifts that overlap the day
  const dayStart = new Date(from).getTime()
  const dayEnd = new Date(to).getTime()
  const overlapping = shifts.filter((s) => {
    const a = new Date(s.starts_at).getTime()
    const b = new Date(s.ends_at).getTime()
    return a < dayEnd && b > dayStart
  })

  const byZone = zones.map((z) => ({
    zone: { id: z.id, code: z.code, name: z.name },
    shifts: overlapping
      .filter((s) => s.zone_id === z.id || s.zone?.id === z.id)
      .map((s) => ({
        id: s.id,
        employee_id: s.employee_id,
        employee_name: s.employee?.display_name || null,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        status: s.status,
        notes: s.notes,
      })),
  }))

  return {
    date: day,
    timezone,
    window: { from, to },
    zone_count: zones.length,
    shift_count: overlapping.length,
    zones: byZone,
  }
}
