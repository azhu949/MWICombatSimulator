<template>
  <ProgressRoot
    data-slot="progress"
    :model-value="value"
    :max="max"
    :class="cn('relative h-1.5 w-full overflow-hidden rounded-md bg-secondary', props.class)"
  >
    <ProgressIndicator
      class="h-full w-full flex-1 bg-primary transition-transform duration-300 ease-out motion-reduce:transition-none"
      :style="{ transform: `translateX(-${100 - percentage}%)` }"
    />
  </ProgressRoot>
</template>

<script setup>
import { computed } from "vue";
import { ProgressIndicator, ProgressRoot } from "reka-ui";
import { cn } from "@/ui/lib/utils.js";

const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 100 },
  class: { type: [String, Array, Object], default: "" },
});

const percentage = computed(() => {
  const safeMax = Number.isFinite(props.max) && props.max > 0 ? props.max : 100;
  return Math.max(0, Math.min(100, (Number(props.value) || 0) / safeMax * 100));
});
</script>
