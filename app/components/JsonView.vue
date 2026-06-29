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
    class="jv-root overflow-auto rounded-lg bg-gray-950 p-4 text-sm leading-relaxed"
    :style="maxHeight ? { maxHeight } : {}"
  ><code v-html="highlighted" /></pre>
</template>

<style>
.jv-root {
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace;
  tab-size: 2;
}
.jv-key {
  color: #93c5fd; /* blue-300 */
}
.jv-string {
  color: #86efac; /* green-300 */
}
.jv-number {
  color: #fca5a5; /* red-300 */
}
.jv-boolean {
  color: #c4b5fd; /* violet-300 */
}
.jv-null {
  color: #6b7280; /* gray-500 */
  font-style: italic;
}
</style>
