<template>
  <AccordionHeader class="flex">
    <AccordionTrigger
      data-slot="accordion-trigger"
      :class="
        cn(
          'group flex min-h-10 flex-1 items-center justify-between gap-3 py-2.5 text-left text-sm font-semibold text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring',
          props.class,
        )
      "
    >
      <slot />
      <ChevronDown
        class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
      />
    </AccordionTrigger>
  </AccordionHeader>
</template>

<script setup>
import { ChevronDown } from '@lucide/vue';
import { AccordionHeader, AccordionTrigger as RekaAccordionTrigger } from 'reka-ui';
import { cn } from '@/ui/lib/utils.js';
const AccordionTrigger = RekaAccordionTrigger;
const props = defineProps({ class: { type: [String, Array, Object], default: '' } });
</script>
