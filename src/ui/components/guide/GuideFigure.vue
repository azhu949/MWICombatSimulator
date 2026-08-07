<template>
  <figure class="overflow-hidden rounded-lg border border-white/10 bg-slate-950/40">
    <a :href="resolvedSrc" target="_blank" rel="noopener noreferrer" :aria-label="`${caption}, ${openLabel}`">
      <img
        :src="resolvedSrc"
        :alt="alt"
        :width="width"
        :height="height"
        class="block h-auto w-full border-b border-white/10"
        loading="lazy"
        decoding="async"
      />
    </a>
    <figcaption class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs leading-5 text-slate-400">
      <span>{{ caption }}</span>
      <a :href="resolvedSrc" target="_blank" rel="noopener noreferrer" class="font-semibold text-amber-200 hover:text-amber-100">
        {{ openLabel }}
      </a>
    </figcaption>
  </figure>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  src: { type: String, required: true },
  alt: { type: String, required: true },
  caption: { type: String, required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  openLabel: { type: String, default: "查看原图" },
});

const baseUrl = String(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
const resolvedSrc = computed(() => {
  const source = String(props.src || "");
  if (!source.startsWith("/")) {
    return source;
  }
  return `${baseUrl}${source.replace(/^\/+/, "")}`;
});
</script>
