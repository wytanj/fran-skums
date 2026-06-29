function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith('/auth') || to.path === '/onboarding' || to.path.startsWith('/m/')) return

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
