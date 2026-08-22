<template>
  <aside :class="['surface-panel', compactHeader ? 'space-y-3' : 'space-y-4']">
    <div :class="['flex justify-between gap-3', compactHeader ? 'items-center' : 'items-start']">
      <div>
        <p v-if="eyebrow" class="text-xs font-semibold text-muted-foreground">{{ eyebrow }}</p>
        <h2
          :class="[
            'font-heading font-semibold text-foreground',
            compactHeader ? 'text-base' : 'text-lg',
            eyebrow ? 'mt-1' : '',
          ]"
        >
          {{ title }}
        </h2>
        <p v-if="showDescription && description" class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
      </div>
      <Badge class="shrink-0" :variant="statusVariant">{{ statusLabel }}</Badge>
    </div>

    <div v-if="showStatusCard" class="rounded-md border border-border bg-muted/45 p-3">
      <p class="text-sm font-medium text-foreground">{{ statusText }}</p>
      <p v-if="isRunning" class="mt-1 text-xs text-muted-foreground">{{ progressText }}</p>
      <Progress v-if="isRunning" class="mt-3" :value="progressPercent" />
    </div>

    <div v-if="showConfigRows && configRows.length > 0" class="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
      <div v-for="row in configRows" :key="row.label" class="rounded-md border border-border bg-muted/30 px-3 py-2">
        <p class="text-[11px] font-semibold text-muted-foreground">{{ row.label }}</p>
        <p class="mt-1 text-sm" :class="rowClass(row.tone)">{{ row.value }}</p>
      </div>
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between gap-2">
        <h3 class="font-heading text-sm font-semibold text-foreground">{{ metricsTitle }}</h3>
        <Button type="button" variant="outline" size="sm" :disabled="!canOpenResults" @click="$emit('view-results')">
          {{ resultsButtonLabel }}
        </Button>
      </div>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-2">
        <div
          v-for="metric in metricRows"
          :key="metric.label"
          class="rounded-md border border-border bg-muted/40 px-3 py-3"
        >
          <p class="text-[11px] font-semibold text-muted-foreground">{{ metric.label }}</p>
          <p class="mt-1 font-heading text-lg" :class="rowClass(metric.tone)">{{ metric.value }}</p>
        </div>
      </div>
    </div>

    <div>
      <h3 class="mb-2 font-heading text-sm font-semibold text-foreground">{{ buildTitle }}</h3>
      <div class="space-y-2">
        <div
          v-for="row in buildRows"
          :key="row.label"
          class="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
        >
          <p class="text-muted-foreground">{{ row.label }}</p>
          <p class="text-foreground">{{ row.value }}</p>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue';
import { Badge } from '../ui/badge/index.js';
import { Button } from '../ui/button/index.js';
import { Progress } from '../ui/progress/index.js';

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

const statusVariant = computed(() => {
  if (props.statusTone === 'running') {
    return 'warning';
  }
  if (props.statusTone === 'ready') {
    return 'success';
  }
  return 'secondary';
});

function rowClass(tone) {
  if (tone === 'success') {
    return 'text-success';
  }
  if (tone === 'danger') {
    return 'text-destructive';
  }
  if (tone === 'accent') {
    return 'text-primary';
  }
  return 'text-foreground';
}
</script>
