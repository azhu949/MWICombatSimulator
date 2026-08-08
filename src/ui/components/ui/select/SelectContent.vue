<template>
  <SelectPortal>
    <SelectContent
      data-slot="select-content"
      position="popper"
      :side-offset="4"
      :class="cn('z-[70] max-h-72 min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', props.class)"
    >
      <SelectViewport class="p-1"><slot /></SelectViewport>
    </SelectContent>
  </SelectPortal>
</template>

<script setup>
import { SelectContent as RekaSelectContent, SelectPortal, SelectViewport } from "reka-ui";
import { cn } from "@/ui/lib/utils.js";
const SelectContent = RekaSelectContent;
const props = defineProps({ class: { type: [String, Array, Object], default: "" } });
</script>
