/**
 * Store rostering — employees, zones, hourly board (Supabase client + RLS).
 */
export function useRoster() {
  const client = useSupabaseClient()
  const { currentWorkspace, memberRole } = useWorkspace()

  const loading = ref(false)
  const error = ref('')
  const zones = ref<any[]>([])
  const employees = ref<any[]>([])
  const shifts = ref<any[]>([])
  const boardDate = ref(
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' }),
  )

  const canWrite = computed(() => {
    const r = (memberRole.value || '').toLowerCase()
    return r === 'owner' || r === 'admin' || r === 'member' || !r
  })

  async function ensureZones() {
    if (!currentWorkspace.value?.id) return []
    const ws = currentWorkspace.value.id
    const { data, error: err } = await client
      .from('roster_zones')
      .select('*')
      .eq('workspace_id', ws)
      .order('sort_order')
    if (err) throw err
    if (data?.length) {
      zones.value = data
      return data
    }
    // seed defaults
    const defaults = [
      { code: 'zone_1', name: 'Zone 1', sort_order: 10 },
      { code: 'zone_2', name: 'Zone 2', sort_order: 20 },
      { code: 'zone_3', name: 'Zone 3', sort_order: 30 },
      { code: 'cashier', name: 'Cashier', sort_order: 40 },
      { code: 'back_of_house', name: 'Back of House', sort_order: 50 },
    ].map((z) => ({ ...z, workspace_id: ws, is_active: true }))
    const { data: seeded, error: sErr } = await client
      .from('roster_zones')
      .upsert(defaults, { onConflict: 'workspace_id,code' })
      .select('*')
    if (sErr) throw sErr
    zones.value = seeded || []
    return zones.value
  }

  async function loadEmployees() {
    if (!currentWorkspace.value?.id) return
    const { data, error: err } = await client
      .from('roster_employees')
      .select('*')
      .eq('workspace_id', currentWorkspace.value.id)
      .order('display_name')
    if (err) throw err
    employees.value = data || []
  }

  async function loadShiftsForDay(dateStr?: string) {
    if (!currentWorkspace.value?.id) return
    const day = dateStr || boardDate.value
    const from = new Date(`${day}T00:00:00+08:00`).toISOString()
    const to = new Date(`${day}T23:59:59.999+08:00`).toISOString()
    const fromWide = new Date(new Date(from).getTime() - 12 * 3600 * 1000).toISOString()
    const toWide = new Date(new Date(to).getTime() + 12 * 3600 * 1000).toISOString()

    const { data, error: err } = await client
      .from('roster_shifts')
      .select(
        `
        *,
        employee:roster_employees(id, display_name, role_label, source_provider),
        zone:roster_zones(id, code, name)
      `,
      )
      .eq('workspace_id', currentWorkspace.value.id)
      .gte('starts_at', fromWide)
      .lte('starts_at', toWide)
      .neq('status', 'cancelled')
      .order('starts_at')
    if (err) throw err

    const dayStart = new Date(from).getTime()
    const dayEnd = new Date(to).getTime()
    shifts.value = (data || []).filter((s: any) => {
      const a = new Date(s.starts_at).getTime()
      const b = new Date(s.ends_at).getTime()
      return a < dayEnd && b > dayStart
    })
  }

  async function loadAll(dateStr?: string) {
    if (!currentWorkspace.value?.id) return
    loading.value = true
    error.value = ''
    try {
      await ensureZones()
      await loadEmployees()
      await loadShiftsForDay(dateStr)
    } catch (e: any) {
      error.value = e?.message || 'Failed to load roster'
    } finally {
      loading.value = false
    }
  }

  async function createEmployee(input: {
    display_name: string
    email?: string
    role_label?: string
    source_provider?: string
    pos_staff_ref?: string
    default_zone_id?: string
  }) {
    if (!currentWorkspace.value?.id) throw new Error('No workspace')
    const { data, error: err } = await client
      .from('roster_employees')
      .insert({
        workspace_id: currentWorkspace.value.id,
        display_name: input.display_name.trim(),
        email: input.email || null,
        role_label: (input.role_label || 'associate').toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
        source_provider: input.source_provider || 'manual',
        pos_staff_ref: input.pos_staff_ref || null,
        default_zone_id: input.default_zone_id || null,
        employment_status: 'active',
        is_active: true,
      })
      .select('*')
      .single()
    if (err) throw err
    return data
  }

  async function createShift(input: {
    employee_id: string
    zone_id: string
    starts_at: string
    ends_at: string
    notes?: string
  }) {
    if (!currentWorkspace.value?.id) throw new Error('No workspace')
    const { data, error: err } = await client
      .from('roster_shifts')
      .insert({
        workspace_id: currentWorkspace.value.id,
        employee_id: input.employee_id,
        zone_id: input.zone_id,
        starts_at: input.starts_at,
        ends_at: input.ends_at,
        status: 'scheduled',
        notes: input.notes || null,
      })
      .select('*')
      .single()
    if (err) throw err
    return data
  }

  const boardByZone = computed(() => {
    return zones.value.map((z) => ({
      zone: z,
      shifts: shifts.value.filter((s) => s.zone_id === z.id || s.zone?.id === z.id),
    }))
  })

  function formatHour(iso: string) {
    return new Date(iso).toLocaleTimeString('en-SG', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Singapore',
      hour12: false,
    })
  }

  return {
    loading,
    error,
    zones,
    employees,
    shifts,
    boardDate,
    boardByZone,
    canWrite,
    loadAll,
    createEmployee,
    createShift,
    formatHour,
  }
}
