<template>
  <NumberFieldRoot
    data-slot="number-field"
    :model-value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    :name="name"
    :class="
      cn(
        'flex h-9 w-full items-stretch overflow-hidden rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35',
        props.class,
      )
    "
    @update:model-value="emit('update:modelValue', $event)"
  >
    <NumberFieldDecrement
      class="grid w-8 shrink-0 place-items-center border-r border-border text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40"
      :aria-label="decrementAriaLabel"
    >
      <Minus class="size-3.5" />
    </NumberFieldDecrement>
    <NumberFieldInput
      :id="id"
      :aria-label="ariaLabel || undefined"
      :aria-labelledby="ariaLabelledby || undefined"
      class="min-w-0 flex-1 bg-transparent px-2 text-center text-sm tabular-nums text-foreground outline-none"
    />
    <NumberFieldIncrement
      class="grid w-8 shrink-0 place-items-center border-l border-border text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40"
      :aria-label="incrementAriaLabel"
    >
      <Plus class="size-3.5" />
    </NumberFieldIncrement>
  </NumberFieldRoot>
</template>

<script setup>
import { computed } from 'vue';
import { Minus, Plus } from '@lucide/vue';
import { NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput, NumberFieldRoot } from 'reka-ui';
import { cn } from '@/ui/lib/utils.js';
import { useI18nText } from '@/ui/composables/useI18nText.js';

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: undefined },
  max: { type: Number, default: undefined },
  step: { type: Number, default: 1 },
  disabled: { type: Boolean, default: false },
  name: { type: String, default: undefined },
  id: { type: String, default: undefined },
  ariaLabel: { type: String, default: '' },
  ariaLabelledby: { type: String, default: '' },
  decrementLabel: { type: String, default: '' },
  incrementLabel: { type: String, default: '' },
  class: { type: [String, Array, Object], default: '' },
});

const emit = defineEmits(['update:modelValue']);
const { t } = useI18nText();
const decrementAriaLabel = computed(() => props.decrementLabel || t('common:controls.decrease', 'Decrease'));
const incrementAriaLabel = computed(() => props.incrementLabel || t('common:controls.increase', 'Increase'));
</script>
