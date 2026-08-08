<template><tbody data-slot="table-body" :class="cn('[&_tr:last-child]:border-0', props.class)"><slot /></tbody></template>
<script setup>
import { cn } from "@/ui/lib/utils.js";
const props = defineProps({ class: { type: [String, Array, Object], default: "" } });
</script>
