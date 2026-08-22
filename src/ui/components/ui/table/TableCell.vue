<template>
  <td data-slot="table-cell" :class="cn('px-3 py-2 align-middle tabular-nums', props.class)"><slot /></td>
</template>
<script setup>
import { cn } from '@/ui/lib/utils.js';
const props = defineProps({ class: { type: [String, Array, Object], default: '' } });
</script>
