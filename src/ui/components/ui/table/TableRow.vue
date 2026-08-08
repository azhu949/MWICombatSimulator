<template><tr data-slot="table-row" :class="cn('border-b border-border/70 transition-colors hover:bg-muted/45 data-[state=selected]:bg-muted', props.class)"><slot /></tr></template>
<script setup>
import { cn } from "@/ui/lib/utils.js";
const props = defineProps({ class: { type: [String, Array, Object], default: "" } });
</script>
