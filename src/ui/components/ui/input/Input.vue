<template>
  <input
    data-slot="input"
    :class="
      cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35',
        props.class,
      )
    "
  />
</template>

<script setup>
import { cn } from '@/ui/lib/utils.js';

const props = defineProps({
  class: { type: [String, Array, Object], default: '' },
});
</script>
