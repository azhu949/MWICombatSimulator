<template>
  <AccordionHeader class="flex">
    <AccordionTrigger
      v-bind="$attrs"
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

// 未声明的透传属性（aria-current 等）默认落到根元素 AccordionHeader（h3）上；可访问性语义需要
// 挂在真正可聚焦的 trigger 按钮上，故关闭自动继承并显式转发给内层 reka AccordionTrigger
// （class 已声明为 prop、经 cn 合并，不参与透传）。
defineOptions({ inheritAttrs: false });
</script>
