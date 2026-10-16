<template>
  <AccordionRoot v-bind="forwardedProps" data-slot="accordion" :class="cn('w-full', props.class)">
    <slot />
  </AccordionRoot>
</template>

<script setup>
import { computed } from 'vue';
import { AccordionRoot, useForwardPropsEmits } from 'reka-ui';
import { cn } from '@/ui/lib/utils.js';

// 显式声明并转发 reka AccordionRoot 的公开契约（type / modelValue / emits 及其余可选 props）：
// 只依赖 attrs fallthrough 时，一旦本组件根节点结构变化（改成多根或加一层包装元素），
// 未声明的 type 与 v-model 会静默失效——多根只在开发模式告警，加包装元素连告警都没有；
// 本项目没有 vue-tsc 之类的类型兜底，只能靠运行时发现，故在此把契约写死。
const props = defineProps({
  class: { type: [String, Array, Object], default: '' },
  type: { type: String, default: undefined },
  modelValue: { type: [String, Array], default: undefined },
  defaultValue: { type: [String, Array], default: undefined },
  collapsible: { type: Boolean, default: undefined },
  disabled: { type: Boolean, default: undefined },
  dir: { type: String, default: undefined },
  orientation: { type: String, default: undefined },
  unmountOnHide: { type: Boolean, default: undefined },
  asChild: { type: Boolean, default: undefined },
  as: { type: [String, Object, Function], default: undefined },
});

const emit = defineEmits(['update:modelValue']);
const forwarded = useForwardPropsEmits(props, emit);

// class 统一由模板的 cn('w-full', props.class) 绑定，从转发结果里剔除，避免同一份 class 透传两次。
const forwardedProps = computed(() => {
  const rest = { ...forwarded.value };
  delete rest.class;
  return rest;
});
</script>
