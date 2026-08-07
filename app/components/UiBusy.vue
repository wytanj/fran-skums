<template>
  <div class="relative">
    <!-- Content stays visible and readable while refreshing — dimming it
         slightly says "this is stale" without hiding what you were reading. -->
    <div :class="busy ? 'pointer-events-none opacity-50 transition-opacity' : 'transition-opacity'">
      <slot />
    </div>
    <Transition name="fade">
      <div v-if="busy" class="pointer-events-none absolute inset-0 flex items-start justify-center pt-8">
        <span class="flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-brown shadow-warm-sm">
          <UiSpinner size="xs" />
          {{ label }}
        </span>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ busy?: boolean; label?: string }>(), { busy: false, label: 'Loading…' })
</script>
