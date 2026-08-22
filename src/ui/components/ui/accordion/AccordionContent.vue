<template>
  <AccordionContent
    data-slot="accordion-content"
    class="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
  >
    <div :class="cn('pb-3', props.class)"><slot /></div>
  </AccordionContent>
</template>

<script setup>
import { AccordionContent as RekaAccordionContent } from 'reka-ui';
import { cn } from '@/ui/lib/utils.js';
const AccordionContent = RekaAccordionContent;
const props = defineProps({ class: { type: [String, Array, Object], default: '' } });
</script>
