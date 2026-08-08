<template>
  <TabsList data-slot="tabs-list" :class="cn('inline-flex min-h-9 w-fit items-center gap-1 rounded-md border border-border bg-muted p-1 text-muted-foreground', props.class)">
    <slot />
  </TabsList>
</template>

<script setup>
import { TabsList as RekaTabsList } from "reka-ui";
import { cn } from "@/ui/lib/utils.js";
const TabsList = RekaTabsList;
const props = defineProps({ class: { type: [String, Array, Object], default: "" } });
</script>
