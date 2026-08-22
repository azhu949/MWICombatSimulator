<template>
  <SelectItem
    data-slot="select-item"
    :class="
      cn(
        'relative flex min-h-8 w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        props.class,
      )
    "
  >
    <span class="absolute left-2 grid size-4 place-items-center">
      <SelectItemIndicator><Check class="size-4" /></SelectItemIndicator>
    </span>
    <SelectItemText><slot /></SelectItemText>
  </SelectItem>
</template>

<script setup>
import { Check } from '@lucide/vue';
import { SelectItem as RekaSelectItem, SelectItemIndicator, SelectItemText } from 'reka-ui';
import { cn } from '@/ui/lib/utils.js';
const SelectItem = RekaSelectItem;
const props = defineProps({ class: { type: [String, Array, Object], default: '' } });
</script>
