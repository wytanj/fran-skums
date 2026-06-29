<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const router = useRouter()
const route = useRoute()
const user = useSupabaseUser()

function getUid(u: any): string | undefined {
  return u?.id || u?.sub
}

function getSafeRedirect(): string {
  const redirect = Array.isArray(route.query.redirect)
    ? route.query.redirect[0]
    : route.query.redirect

  if (typeof redirect !== 'string') return '/'
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return '/'
  if (redirect.startsWith('/auth/')) return '/'
  return redirect
}

onMounted(async () => {
  if (!getUid(user.value)) {
    await new Promise<void>((resolve) => {
      const unwatch = watch(user, (val) => {
        if (getUid(val)) {
          unwatch()
          resolve()
        }
      }, { immediate: true })
      setTimeout(() => { unwatch(); resolve() }, 3000)
    })
  }

  await router.replace(getSafeRedirect())
})
</script>

<template>
  <div class="card p-8 text-center">
    <div class="mb-4 flex justify-center">
      <svg class="h-12 w-12 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    </div>
    <h2 class="text-xl font-semibold text-white">Completing sign in</h2>
    <p class="mt-2 text-sm text-gray-400">Redirecting you...</p>
  </div>
</template>
