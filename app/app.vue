<template>
  <!-- Progress bar acknowledges navigation while pages await data -->
  <NuxtLoadingIndicator color="#F0C820" :height="3" :throttle="80" :duration="2500" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
import '~/assets/css/main.css'
</script>
