<template>
  <TabsRoot data-slot="tabs" :class="cn('flex flex-col gap-3', props.class)">
    <slot />
  </TabsRoot>
</template>

<script setup>
import { TabsRoot } from "reka-ui";
import { cn } from "@/ui/lib/utils.js";
const props = defineProps({ class: { type: [String, Array, Object], default: "" } });
</script>
