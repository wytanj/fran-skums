<script setup lang="ts">
const props = defineProps<{
  data: any
  maxHeight?: string
}>()

function colorize(json: string): string {
  return json.replace(
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")\s*:/g,
    '<span class="jv-key">$1</span>:',
  ).replace(
    /:\s*("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")/g,
    ': <span class="jv-string">$1</span>',
  ).replace(
    /:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g,
    ': <span class="jv-number">$1</span>',
  ).replace(
    /:\s*(true|false)\b/g,
    ': <span class="jv-boolean">$1</span>',
  ).replace(
    /:\s*(null)\b/g,
    ': <span class="jv-null">$1</span>',
  ).replace(
    /(?<=[\[,\n]\s*)"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*[,\]\n])/g,
    '<span class="jv-string">$&</span>',
  )
}

const highlighted = computed(() => {
  try {
    const raw = JSON.stringify(props.data, null, 2)
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return colorize(escaped)
  } catch {
    return String(props.data)
  }
})
</script>

<template>
  <pre
    class="jv-root overflow-auto rounded-lg border border-line-soft bg-surface-sunken p-4 text-sm leading-relaxed text-ink"
    :style="maxHeight ? { maxHeight } : {}"
  ><code v-html="highlighted" /></pre>
</template>

<style>
.jv-root {
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace;
  tab-size: 2;
}
.jv-key {
  color: #5C4030; /* ink-soft / brown */
}
.jv-string {
  color: #2D8A5E; /* success */
}
.jv-number {
  color: #C47A1A; /* warning */
}
.jv-boolean {
  color: #3A2415; /* ink */
}
.jv-null {
  color: #8B7355; /* muted */
}
</style>
