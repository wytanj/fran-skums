function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

/**
 * Paths a signed-in user must reach BEFORE they have a workspace.
 *
 * /invite/* is the obvious one and was the bug: an invitee has no workspace by
 * definition, so bouncing them to /onboarding meant the invite link never opened
 * for exactly the people it was sent to — and the page they landed on offered to
 * create a workspace, which is the wrong outcome. They'd end up owning an empty
 * one instead of joining the team's.
 *
 * /oauth/* matters for the same reason: the MCP consent screen has to be able to
 * load and say "this account is not a member of any Fran workspace". Redirecting
 * to onboarding there both hides the explanation and tempts the user into
 * creating a workspace that Claude would then silently connect to.
 */
const NO_WORKSPACE_REQUIRED = ['/auth', '/onboarding', '/m/', '/invite/', '/oauth/']

export default defineNuxtRouteMiddleware(async (to) => {
  if (NO_WORKSPACE_REQUIRED.some((p) => to.path === p || to.path.startsWith(p))) return

  const user = useSupabaseUser()

  // Wait for Supabase auth to fully hydrate (up to 3 seconds)
  if (!getUid(user.value)) {
    await new Promise<void>((resolve) => {
      if (getUid(user.value)) return resolve()
      const unwatch = watch(user, (val) => {
        if (getUid(val)) {
          unwatch()
          resolve()
        }
      }, { immediate: true })
      setTimeout(() => { unwatch(); resolve() }, 3000)
    })
  }

  // Still no user after waiting — not logged in
  if (!getUid(user.value)) {
    // Allow landing page at / for unauthenticated users
    if (to.path === '/') return
    // Everything else: let Supabase module handle redirect to login
    return
  }

  const { currentWorkspace, hasFetched, fetchWorkspaces } = useWorkspace()

  if (!hasFetched.value) {
    await fetchWorkspaces()
  }

  if (!currentWorkspace.value) {
    return navigateTo('/onboarding')
  }
})
