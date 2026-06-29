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
  <div class="card p-8">
    <h2 class="mb-6 text-xl font-semibold text-white">
      {{ mode === 'login' ? 'Sign in to your account' : 'Create a new account' }}
    </h2>

    <div
      v-if="error"
      :class="[
        'mb-4 rounded-lg px-4 py-3 text-sm',
        error.includes('Check your email')
          ? 'bg-emerald-500/10 text-emerald-400'
          : 'bg-red-500/10 text-red-400',
      ]"
    >
      {{ error }}
    </div>

    <!-- Google OAuth -->
    <button
      type="button"
      class="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-medium text-white transition-all hover:border-gray-600 hover:bg-gray-700 disabled:opacity-50"
      :disabled="googleLoading"
      @click="handleGoogleLogin"
    >
      <svg v-if="googleLoading" class="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <svg v-else class="h-5 w-5" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
      Continue with Google
    </button>

    <div class="relative my-6">
      <div class="absolute inset-0 flex items-center">
        <div class="w-full border-t border-gray-800" />
      </div>
      <div class="relative flex justify-center">
        <span class="bg-gray-900 px-3 text-xs text-gray-500">or continue with email</span>
      </div>
    </div>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <div>
        <label class="label-field">Email</label>
        <input
          v-model="email"
          type="email"
          required
          placeholder="you@company.com"
          class="input-field"
        />
      </div>

      <div>
        <label class="label-field">Password</label>
        <input
          v-model="password"
          type="password"
          required
          placeholder="********"
          minlength="6"
          class="input-field"
        />
      </div>

      <button type="submit" class="btn-primary w-full" :disabled="loading">
        <svg v-if="loading" class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {{ mode === 'login' ? 'Sign in' : 'Create account' }}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-gray-400">
      <template v-if="mode === 'login'">
        Don't have an account?
        <button class="font-medium text-indigo-400 hover:text-indigo-300" @click="mode = 'signup'">
          Sign up
        </button>
      </template>
      <template v-else>
        Already have an account?
        <button class="font-medium text-indigo-400 hover:text-indigo-300" @click="mode = 'login'">
          Sign in
        </button>
      </template>
    </p>
  </div>
</template>
