<template>
  <TabsContent
    data-slot="tabs-content"
    :class="cn('min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring', props.class)"
  >
    <slot />
  </TabsContent>
</template>

<script setup>
import { TabsContent as RekaTabsContent } from 'reka-ui';
import { cn } from '@/ui/lib/utils.js';
const TabsContent = RekaTabsContent;
const props = defineProps({ class: { type: [String, Array, Object], default: '' } });
</script>
