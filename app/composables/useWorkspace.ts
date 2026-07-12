import type { Workspace } from '~/types'

const currentWorkspace = ref<Workspace | null>(null)
const workspaces = ref<Workspace[]>([])
const memberRole = ref<string>('member')
const hasFetched = ref(false)

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

export function useWorkspace() {
  const client = useSupabaseClient()
  const user = useSupabaseUser()

  async function fetchWorkspaces() {
    const uid = getUid(user.value)
    if (!uid) {
      console.warn('[SKUMS] fetchWorkspaces called but no user id. user.value:', JSON.stringify(user.value))
      return
    }

    console.log('[SKUMS] Fetching workspaces for user:', uid)

    // First try: get memberships
    const { data: memberships, error: memErr } = await client
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', uid)

    console.log('[SKUMS] Memberships:', memberships, 'Error:', memErr?.message)

    let foundWorkspaces: Workspace[] = []

    if (memberships && memberships.length > 0) {
      const wsIds = memberships.map((m: any) => m.workspace_id)
      const { data: wsData, error: wsErr } = await client
        .from('workspaces')
        .select('*')
        .in('id', wsIds)

      console.log('[SKUMS] Workspaces via membership:', wsData, 'Error:', wsErr?.message)

      if (wsData && wsData.length > 0) {
        foundWorkspaces = wsData as Workspace[]
      }
    }

    // Fallback: check for owned workspaces directly
    if (foundWorkspaces.length === 0) {
      const { data: ownedWs, error: ownErr } = await client
        .from('workspaces')
        .select('*')
        .eq('owner_id', uid)

      console.log('[SKUMS] Owned workspaces fallback:', ownedWs, 'Error:', ownErr?.message)

      if (ownedWs && ownedWs.length > 0) {
        foundWorkspaces = ownedWs as Workspace[]
      }
    }

    console.log('[SKUMS] Final found workspaces:', foundWorkspaces.length)

    workspaces.value = foundWorkspaces

    if (foundWorkspaces.length > 0 && !currentWorkspace.value) {
      currentWorkspace.value = foundWorkspaces[0]
      if (memberships && memberships.length > 0) {
        const match = memberships.find((m: any) => m.workspace_id === foundWorkspaces[0].id)
        memberRole.value = match?.role || 'owner'
      } else {
        memberRole.value = 'owner'
      }
    }

    hasFetched.value = true
  }

  async function selectWorkspace(ws: Workspace) {
    currentWorkspace.value = ws
    const uid = getUid(user.value)
    if (!uid) return
    if (ws.owner_id === uid) {
      memberRole.value = 'owner'
      return
    }
    const { data: mem } = await client
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', ws.id)
      .eq('user_id', uid)
      .maybeSingle()
    memberRole.value = mem?.role || 'member'
  }

  async function createWorkspace(name: string, organizationId?: string) {
    if (!getUid(user.value)) throw new Error('User not authenticated — please refresh and try again.')

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    const payload: { ws_name: string; ws_slug: string; ws_org_id?: string } = {
      ws_name: name,
      ws_slug: slug,
    }
    if (organizationId) payload.ws_org_id = organizationId

    const { data, error } = await client.rpc('create_workspace', payload)

    if (error) throw error

    const ws = data as unknown as Workspace
    currentWorkspace.value = ws
    workspaces.value = [...workspaces.value, ws]
    memberRole.value = 'owner'
    return ws
  }

  return {
    currentWorkspace,
    workspaces,
    memberRole,
    hasFetched,
    fetchWorkspaces,
    selectWorkspace,
    createWorkspace,
  }
}
