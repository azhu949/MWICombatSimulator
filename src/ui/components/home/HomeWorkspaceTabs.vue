<template>
  <nav class="panel p-2" :aria-label="ariaLabel">
    <div class="grid gap-2 md:grid-cols-3">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        class="workspace-tab"
        :class="modelValue === tab.value ? 'workspace-tab-active' : ''"
        :aria-pressed="modelValue === tab.value ? 'true' : 'false'"
        @click="$emit('update:modelValue', tab.value)"
      >
        <span class="font-heading text-sm font-semibold">{{ tab.label }}</span>
        <span class="mt-1 text-xs leading-5 text-slate-400">{{ tab.description }}</span>
      </button>
    </div>
  </nav>
</template>

<script setup>
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

