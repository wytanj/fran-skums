// Tracks the navigation currently in flight so the sidebar can light up the
// destination tab immediately (pages often await data in setup).
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const target = useState<string | null>('nav-target', () => null)

  router.beforeEach((to, from) => {
    target.value = to.fullPath === from.fullPath ? null : to.fullPath
  })
  router.afterEach(() => { target.value = null })
  router.onError(() => { target.value = null })
  nuxtApp.hook('page:finish', () => { target.value = null })
})
