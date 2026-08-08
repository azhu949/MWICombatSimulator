<template>
  <AccordionRoot data-slot="accordion" :class="cn('w-full', props.class)">
    <slot />
  </AccordionRoot>
</template>

<script setup>
import { AccordionRoot } from "reka-ui";
import { cn } from "@/ui/lib/utils.js";
const props = defineProps({ class: { type: [String, Array, Object], default: "" } });
</script>
