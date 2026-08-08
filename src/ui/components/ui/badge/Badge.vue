<template>
  <component
    :is="as"
    data-slot="badge"
    :class="cn(badgeVariants({ variant }), props.class)"
  >
    <slot />
  </component>
</template>

<script setup>
import { cn } from "@/ui/lib/utils.js";
import { badgeVariants } from "./variants.js";

const props = defineProps({
  variant: { type: String, default: "secondary" },
  as: { type: [String, Object], default: "span" },
  class: { type: [String, Array, Object], default: "" },
});
</script>
