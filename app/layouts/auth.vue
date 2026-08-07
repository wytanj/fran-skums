<template>
  <div class="flex min-h-screen items-center justify-center bg-cream px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <p class="eyebrow">Fran product ops</p>
        <h1 class="h1-display text-[36px]">
          Fran <span class="text-brown">SKUMS</span>
        </h1>
        <p class="mt-1 text-[13px] text-muted">Catalogue, inventory, API &amp; MCP</p>
      </div>
      <slot />
    </div>

    <ToastHost />
  </div>
</template>
