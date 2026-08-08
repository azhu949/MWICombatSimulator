<template>
  <select
    data-slot="native-select"
    :value="modelValue"
    :class="cn('h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-xs outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35', props.class)"
    @change="handleChange"
  >
    <slot />
  </select>
</template>

<script setup>
import { cn } from "@/ui/lib/utils.js";

const props = defineProps({
  modelValue: { default: "" },
  modelModifiers: { type: Object, default: () => ({}) },
  class: { type: [String, Array, Object], default: "" },
});

const emit = defineEmits(["update:modelValue", "change"]);

function optionValue(option) {
  const value = Object.hasOwn(option, "_value") ? option._value : option.value;
  if (!props.modelModifiers.number) {
    return value;
  }
  const numericValue = Number.parseFloat(value);
  return Number.isNaN(numericValue) ? value : numericValue;
}

function handleChange(event) {
  const select = event.target;
  const value = select.multiple
    ? Array.from(select.selectedOptions, optionValue)
    : optionValue(select.selectedOptions[0]);
  emit("update:modelValue", value);
  emit("change", event);
}
</script>
