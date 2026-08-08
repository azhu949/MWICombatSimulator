<template><th data-slot="table-head" :class="cn('h-9 whitespace-nowrap px-3 text-left align-middle text-xs font-semibold text-muted-foreground', props.class)"><slot /></th></template>
<script setup>
import { cn } from "@/ui/lib/utils.js";
const props = defineProps({ class: { type: [String, Array, Object], default: "" } });
</script>
