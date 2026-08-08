<template>
  <RekaLabel
    data-slot="label"
    :class="cn('flex items-center gap-2 text-xs font-semibold text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50', props.class)"
  >
    <slot />
  </RekaLabel>
</template>

<script setup>
import { Label as RekaLabel } from "reka-ui";
import { cn } from "@/ui/lib/utils.js";

const props = defineProps({
  class: { type: [String, Array, Object], default: "" },
});
</script>
