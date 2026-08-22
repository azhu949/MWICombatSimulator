<template>
  <thead data-slot="table-header" :class="cn('[&_tr]:border-b', props.class)">
    <slot />
  </thead>
</template>
<script setup>
import { cn } from '@/ui/lib/utils.js';
const props = defineProps({ class: { type: [String, Array, Object], default: '' } });
</script>
