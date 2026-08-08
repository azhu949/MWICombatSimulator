<template>
  <ComboboxRoot
    :model-value="rekaModelValue"
    :open="isOpen"
    :disabled="disabled"
    :ignore-filter="true"
    :open-on-click="true"
    :open-on-focus="true"
    :reset-search-term-on-select="true"
    @update:model-value="handleModelValueChange"
    @update:open="handleOpenChange"
  >
    <ComboboxAnchor :class="cn('flex h-9 w-full items-center rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35', props.class)">
      <ComboboxInput
        v-model="searchTerm"
        class="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm text-foreground outline-none focus-visible:outline-none! placeholder:text-muted-foreground"
        :placeholder="placeholder"
        :display-value="displayValue"
        :aria-label="ariaLabel || placeholder"
      />
      <ComboboxTrigger class="grid size-8 shrink-0 place-items-center text-muted-foreground outline-none hover:text-foreground" :aria-label="openLabel">
        <ChevronsUpDown class="size-4" />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        side="bottom"
        align="start"
        :side-offset="4"
        :collision-padding="8"
        class="z-[70] max-h-72 w-[var(--reka-combobox-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      >
        <ComboboxViewport class="max-h-72 overflow-y-auto p-1">
          <ComboboxEmpty class="px-3 py-6 text-center text-sm text-muted-foreground">{{ emptyLabel }}</ComboboxEmpty>
          <ComboboxItem
            v-for="option in visibleOptions"
            :key="option.value"
            :value="option.value"
            :text-value="option.label"
            class="relative flex min-h-8 cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ComboboxItemIndicator class="absolute left-2 grid size-4 place-items-center">
              <Check class="size-4" />
            </ComboboxItemIndicator>
            <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
          </ComboboxItem>
          <p v-if="filteredOptions.length > visibleOptions.length" class="px-3 py-2 text-xs text-muted-foreground">
            {{ moreResultsLabel.replace("{count}", String(filteredOptions.length - visibleOptions.length)) }}
          </p>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { Check, ChevronsUpDown } from "@lucide/vue";
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from "reka-ui";
import { cn } from "@/ui/lib/utils.js";

const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  options: { type: Array, default: () => [] },
  maxResults: { type: Number, default: 80 },
  placeholder: { type: String, default: "Search" },
  emptyLabel: { type: String, default: "No results" },
  moreResultsLabel: { type: String, default: "Refine the search to see {count} more results" },
  openLabel: { type: String, default: "Open options" },
  ariaLabel: { type: String, default: "" },
  disabled: { type: Boolean, default: false },
  class: { type: [String, Array, Object], default: "" },
});

const emit = defineEmits(["update:modelValue"]);
const EMPTY_COMBOBOX_VALUE = "__mwi_combobox_empty__";
const isOpen = ref(false);
const searchTerm = ref("");
const rekaModelValue = computed(() => toRekaValue(props.modelValue));
const normalizedTerm = computed(() => (
  isOpen.value ? searchTerm.value.trim().toLocaleLowerCase() : ""
));
const filteredOptions = computed(() => {
  const list = props.options.map((option) => ({
    value: toRekaValue(option.value),
    label: String(option.label || option.value),
  }));
  if (!normalizedTerm.value) {
    return list;
  }
  return list.filter((option) => option.label.toLocaleLowerCase().includes(normalizedTerm.value));
});
const visibleOptions = computed(() => filteredOptions.value.slice(0, Math.max(1, props.maxResults)));

function displayValue(value) {
  const rawValue = fromRekaValue(value);
  const option = props.options.find((entry) => entry.value === rawValue);
  return option ? String(option.label || option.value || "") : "";
}

function toRekaValue(value) {
  return value === "" || value == null ? EMPTY_COMBOBOX_VALUE : value;
}

function fromRekaValue(value) {
  return value === EMPTY_COMBOBOX_VALUE ? "" : value;
}

function handleModelValueChange(value) {
  emit("update:modelValue", fromRekaValue(value));
}

function handleOpenChange(value) {
  isOpen.value = value;
  if (value) {
    searchTerm.value = "";
  }
}

watch(
  () => props.options,
  () => {
    if (!isOpen.value) {
      searchTerm.value = displayValue(props.modelValue);
    }
  },
  { deep: true },
);
</script>
