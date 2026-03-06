<template>
  <aside :class="['panel', compactHeader ? 'space-y-3' : 'space-y-4']">
    <div :class="['flex justify-between gap-3', compactHeader ? 'items-center' : 'items-start']">
      <div>
        <p v-if="eyebrow" class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ eyebrow }}</p>
        <h2 :class="[
          'font-heading font-semibold text-amber-200',
          compactHeader ? 'text-base' : 'text-lg',
          eyebrow ? 'mt-1' : ''
        ]">{{ title }}</h2>
        <p v-if="showDescription && description" class="mt-1 text-sm text-slate-400">{{ description }}</p>
      </div>
      <span class="badge shrink-0" :class="statusClass">{{ statusLabel }}</span>
    </div>

    <div v-if="showStatusCard" class="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
      <p class="text-sm font-medium text-slate-100">{{ statusText }}</p>
      <p v-if="isRunning" class="mt-1 text-xs uppercase tracking-[0.14em] text-slate-400">{{ progressText }}</p>
      <div v-if="isRunning" class="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          class="h-full bg-gradient-to-r from-teal-400 to-amber-300 transition-all"
          :style="{ width: `${progressPercent}%` }"
        ></div>
      </div>
    </div>

    <div v-if="showConfigRows && configRows.length > 0" class="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
      <div
        v-for="row in configRows"
        :key="row.label"
        class="rounded-xl border border-white/10 bg-slate-900/30 px-3 py-2"
      >
        <p class="text-[11px] uppercase tracking-[0.12em] text-slate-400">{{ row.label }}</p>
        <p class="mt-1 text-sm" :class="rowClass(row.tone)">{{ row.value }}</p>
      </div>
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between gap-2">
        <h3 class="font-heading text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">{{ metricsTitle }}</h3>
        <button
          type="button"
          class="action-button-muted px-3 py-1.5 text-xs"
          :disabled="!canOpenResults"
          @click="$emit('view-results')"
        >
          {{ resultsButtonLabel }}
        </button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-2">
        <div
          v-for="metric in metricRows"
          :key="metric.label"
          class="rounded-xl border border-white/10 bg-slate-900/45 px-3 py-3"
        >
          <p class="text-[11px] uppercase tracking-[0.12em] text-slate-400">{{ metric.label }}</p>
          <p class="mt-1 font-heading text-lg" :class="rowClass(metric.tone)">{{ metric.value }}</p>
        </div>
      </div>
    </div>

    <div>
      <h3 class="mb-2 font-heading text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">{{ buildTitle }}</h3>
      <div class="space-y-2">
        <div
          v-for="row in buildRows"
          :key="row.label"
          class="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-white/10 bg-slate-900/30 px-3 py-2 text-sm"
        >
          <p class="text-slate-300">{{ row.label }}</p>
          <p class="text-slate-100">{{ row.value }}</p>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  eyebrow: {
    type: String,
    default: '',
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  showDescription: {
    type: Boolean,
    default: true,
  },
  compactHeader: {
    type: Boolean,
    default: false,
  },
  statusLabel: {
    type: String,
    required: true,
  },
  statusText: {
    type: String,
    required: true,
  },
  showStatusCard: {
    type: Boolean,
    default: true,
  },
  statusTone: {
    type: String,
    default: 'idle',
  },
  isRunning: {
    type: Boolean,
    default: false,
  },
  progressText: {
    type: String,
    default: '',
  },
  progressPercent: {
    type: Number,
    default: 0,
  },
  configRows: {
    type: Array,
    default: () => [],
  },
  showConfigRows: {
    type: Boolean,
    default: true,
  },
  metricRows: {
    type: Array,
    default: () => [],
  },
  buildRows: {
    type: Array,
    default: () => [],
  },
  metricsTitle: {
    type: String,
    default: '',
  },
  buildTitle: {
    type: String,
    default: '',
  },
  canOpenResults: {
    type: Boolean,
    default: false,
  },
  resultsButtonLabel: {
    type: String,
    required: true,
  },
});

defineEmits(['view-results']);

const statusClass = computed(() => {
  if (props.statusTone === 'running') {
    return 'border-amber-300/40 bg-amber-300/10 text-amber-200';
  }
  if (props.statusTone === 'ready') {
    return 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200';
  }
  return 'border-white/10 bg-white/5 text-slate-300';
});

function rowClass(tone) {
  if (tone === 'success') {
    return 'text-emerald-300';
  }
  if (tone === 'danger') {
    return 'text-rose-300';
  }
  if (tone === 'accent') {
    return 'text-amber-200';
  }
  return 'text-slate-100';
}
</script>

