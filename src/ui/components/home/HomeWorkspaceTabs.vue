<template>
  <Tabs
    :model-value="modelValue"
    class="surface-panel p-2"
    :aria-label="ariaLabel"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <TabsList class="grid h-auto w-full gap-1 border-0 bg-transparent p-0 md:grid-cols-3">
      <TabsTrigger
        v-for="tab in tabs"
        :key="tab.value"
        :value="tab.value"
        class="h-auto min-w-0 flex-col items-start px-3 py-2.5 text-left data-[state=active]:bg-accent"
      >
        <span class="font-heading text-sm font-semibold">{{ tab.label }}</span>
        <span class="mt-1 whitespace-normal text-xs font-normal leading-5 text-muted-foreground">{{
          tab.description
        }}</span>
      </TabsTrigger>
    </TabsList>
  </Tabs>
</template>

<script setup>
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs/index.js';

defineProps({
  modelValue: {
    type: String,
    required: true,
  },
  tabs: {
    type: Array,
    required: true,
  },
  ariaLabel: {
    type: String,
    default: '',
  },
});

defineEmits(['update:modelValue']);
</script>
