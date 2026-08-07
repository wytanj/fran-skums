<template>
  <label class="block">
    <span v-if="label" class="mb-1.5 block text-[12px] font-semibold tracking-wide text-ink-soft">{{ label }}</span>
    <input
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      :inputmode="inputmode"
      :maxlength="maxlength"
      class="h-[52px] w-full rounded-lg border bg-white px-4 text-[15px] text-ink placeholder:text-muted focus:border-brown focus:outline-none"
      :class="error ? 'border-danger' : 'border-line'"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
    <span v-if="error" class="mt-1 block text-[13px] text-danger">{{ error }}</span>
    <span v-else-if="hint" class="mt-1 block text-[13px] text-muted">{{ hint }}</span>
  </label>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue?: string
  label?: string
  type?: string
  placeholder?: string
  error?: string
  hint?: string
  inputmode?: 'text' | 'numeric' | 'email'
  maxlength?: number
}>(), { type: 'text' })

defineEmits(['update:modelValue'])
</script>
