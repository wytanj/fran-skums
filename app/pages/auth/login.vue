<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const client = useSupabaseClient()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const googleLoading = ref(false)
const error = ref('')
const mode = ref<'login' | 'signup'>('login')

function getSafeRedirect(): string {
  const redirect = Array.isArray(route.query.redirect)
    ? route.query.redirect[0]
    : route.query.redirect

  if (typeof redirect !== 'string') return '/'
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return '/'
  if (redirect.startsWith('/auth/')) return '/'
  return redirect
}

function getAuthCallbackUrl(): string {
  const redirect = getSafeRedirect()
  const callback = new URL('/auth/confirm', window.location.origin)
  if (redirect !== '/') callback.searchParams.set('redirect', redirect)
  return callback.toString()
}

const connectingClaude = computed(() => getSafeRedirect().startsWith('/oauth/authorize'))

async function handleSubmit() {
  loading.value = true
  error.value = ''

  try {
    if (mode.value === 'login') {
      const { error: authError } = await client.auth.signInWithPassword({
        email: email.value,
        password: password.value,
      })
      if (authError) throw authError
    } else {
      const { error: authError } = await client.auth.signUp({
        email: email.value,
        password: password.value,
        options: { emailRedirectTo: getAuthCallbackUrl() },
      })
      if (authError) throw authError
      error.value = 'Check your email to confirm your account.'
      loading.value = false
      return
    }
    router.push(getSafeRedirect())
  } catch (e: any) {
    error.value = e.message || 'Something went wrong'
  } finally {
    loading.value = false
  }
}

async function handleGoogleLogin() {
  googleLoading.value = true
  error.value = ''
  try {
    const { error: authError } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthCallbackUrl(),
      },
    })
    if (authError) throw authError
  } catch (e: any) {
    error.value = e.message || 'Failed to sign in with Google'
    googleLoading.value = false
  }
}
</script>

<template>
  <div>
    <UiCard v-if="connectingClaude" tone="blue" class="mb-3 !p-3">
      <p class="text-[13px] font-semibold text-brown">Connecting Claude</p>
      <p class="mt-0.5 text-[12px] text-ink-soft">
        Sign in so Claude gets tools scoped to your workspace and role.
      </p>
    </UiCard>

    <UiCard tone="surface">
      <h2 class="mb-1 font-display text-[22px] font-bold text-ink">
        {{ mode === 'login' ? 'Sign in' : 'Create account' }}
      </h2>
      <p class="mb-5 text-[13px] text-muted">
        {{ mode === 'login' ? 'Email, Google, or continue to the API / MCP tools.' : 'A workspace is created after you confirm email.' }}
      </p>

      <div
        v-if="error"
        :class="[
          'mb-4 rounded-lg px-3.5 py-2.5 text-[13px]',
          error.includes('Check your email')
            ? 'bg-success-soft text-success'
            : 'bg-danger-soft text-danger',
        ]"
      >
        {{ error }}
      </div>

      <button
        type="button"
        class="press flex w-full items-center justify-center gap-3 rounded-full border border-line bg-white px-4 py-2.5 text-[14px] font-semibold text-ink transition-all hover:bg-surface-sunken disabled:opacity-50"
        :disabled="googleLoading"
        @click="handleGoogleLogin"
      >
        <UiSpinner v-if="googleLoading" size="sm" />
        <svg v-else class="h-5 w-5" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continue with Google
      </button>

      <div class="relative my-5">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full border-t border-line" />
        </div>
        <div class="relative flex justify-center">
          <span class="bg-white px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">or email</span>
        </div>
      </div>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <UiInput v-model="email" label="Email" type="email" placeholder="you@company.com" />
        <UiInput v-model="password" label="Password" type="password" placeholder="••••••••" />
        <UiButton type="submit" :loading="loading" class="w-full">
          {{ mode === 'login' ? 'Sign in' : 'Create account' }}
        </UiButton>
      </form>

      <p class="mt-5 text-center text-[13px] text-muted">
        <template v-if="mode === 'login'">
          Don't have an account?
          <button type="button" class="font-semibold text-brown hover:underline" @click="mode = 'signup'">
            Sign up
          </button>
        </template>
        <template v-else>
          Already have an account?
          <button type="button" class="font-semibold text-brown hover:underline" @click="mode = 'login'">
            Sign in
          </button>
        </template>
      </p>
    </UiCard>
  </div>
</template>
