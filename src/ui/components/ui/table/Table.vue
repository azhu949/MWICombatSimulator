<template>
  <div data-slot="table-container" class="relative w-full overflow-x-auto">
    <table data-slot="table" :class="cn('w-full caption-bottom text-sm', props.class)">
      <slot />
    </table>
  </div>
</template>

<script setup>
import { cn } from '@/ui/lib/utils.js';
const props = defineProps({ class: { type: [String, Array, Object], default: '' } });
</script>
