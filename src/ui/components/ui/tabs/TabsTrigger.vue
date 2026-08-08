<template>
  <TabsTrigger data-slot="tabs-trigger" :class="cn('inline-flex min-h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-1 text-xs font-semibold outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs', props.class)">
    <slot />
  </TabsTrigger>
</template>

<script setup>
import { TabsTrigger as RekaTabsTrigger } from "reka-ui";
import { cn } from "@/ui/lib/utils.js";
const TabsTrigger = RekaTabsTrigger;
const props = defineProps({ class: { type: [String, Array, Object], default: "" } });
</script>
