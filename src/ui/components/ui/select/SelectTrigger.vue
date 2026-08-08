<template>
  <SelectTrigger data-slot="select-trigger" :class="cn('flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs outline-none focus-visible:outline-none! transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate', props.class)">
    <SelectValue :placeholder="placeholder" />
    <ChevronDown class="size-4 shrink-0 text-muted-foreground" />
  </SelectTrigger>
</template>

<script setup>
import { ChevronDown } from "@lucide/vue";
import { SelectTrigger as RekaSelectTrigger, SelectValue } from "reka-ui";
import { cn } from "@/ui/lib/utils.js";
const SelectTrigger = RekaSelectTrigger;
const props = defineProps({
  placeholder: { type: String, default: "" },
  class: { type: [String, Array, Object], default: "" },
});
</script>
