<template>
  <AccordionItem data-slot="accordion-item" :class="cn('border-b border-border last:border-b-0', props.class)">
    <slot />
  </AccordionItem>
</template>

<script setup>
import { AccordionItem as RekaAccordionItem } from 'reka-ui';
import { cn } from '@/ui/lib/utils.js';
const AccordionItem = RekaAccordionItem;
const props = defineProps({ class: { type: [String, Array, Object], default: '' } });
</script>
