<template>
  <section
    ref="commandBarRoot"
    class="sticky top-12 z-30 border-b border-border bg-card/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/90 sm:px-5"
    aria-label="Combat command bar"
  >
    <div class="mx-auto flex max-w-[1500px] flex-col gap-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <Button
          v-if="showSimulationActions && !simulationRunning"
          type="button"
          size="sm"
          :disabled="simulationActionsDisabled"
          @click="emit('start-simulation')"
        >
          <Play />{{ t('common:controls.startSimulation', 'Start Simulation') }}
        </Button>
        <Button
          v-else-if="showSimulationActions"
          type="button"
          variant="destructive"
          size="sm"
          @click="emit('stop-simulation')"
        >
          <Square />{{ t('common:controls.stopSimulation', 'Stop') }}
        </Button>

        <div class="hidden shrink-0 items-center gap-2 2xl:flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="queueActionsDisabled"
            @click="emit('set-baseline')"
          >
            <Gauge />{{ t('common:queue.setBaseline', 'Set Baseline') }}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="queueActionsDisabled || !hasBaseline || partyMismatch"
            @click="emit('add-queue')"
          >
            <ListPlus />{{ t('common:queue.addToQueue', 'Add To Queue') }}
          </Button>
          <Button
            type="button"
            size="sm"
            :disabled="queueActionsDisabled || !hasBaseline || itemCount === 0 || partyMismatch"
            @click="emit('run-queue')"
          >
            <Play />{{ t('common:queue.runQueue', 'Run Queue') }}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            :disabled="queueActionsDisabled || itemCount === 0"
            @click="emit('clear-queue')"
          >
            <Trash2 />{{ t('common:queue.clearQueue', 'Clear Queue') }}
          </Button>
        </div>

        <Button
          class="2xl:hidden"
          type="button"
          size="sm"
          :disabled="queueActionsDisabled || !hasBaseline || itemCount === 0 || partyMismatch"
          @click="emit('run-queue')"
        >
          <Play />{{ t('common:queue.runQueue', 'Run Queue') }}
        </Button>
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child>
            <Button
              class="2xl:hidden"
              type="button"
              variant="outline"
              size="icon-sm"
              :aria-label="t('common:vue.app.moreActions', 'More actions')"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              class="z-50 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl"
              :side-offset="6"
              align="start"
            >
              <DropdownMenuItem
                class="command-menu-item"
                :disabled="queueActionsDisabled"
                @select="emit('set-baseline')"
                ><Gauge />{{ t('common:queue.setBaseline', 'Set Baseline') }}</DropdownMenuItem
              >
              <DropdownMenuItem
                class="command-menu-item"
                :disabled="queueActionsDisabled || !hasBaseline || partyMismatch"
                @select="emit('add-queue')"
                ><ListPlus />{{ t('common:queue.addToQueue', 'Add To Queue') }}</DropdownMenuItem
              >
              <DropdownMenuItem
                class="command-menu-item text-destructive"
                :disabled="queueActionsDisabled || itemCount === 0"
                @select="emit('clear-queue')"
                ><Trash2 />{{ t('common:queue.clearQueue', 'Clear Queue') }}</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>

        <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pl-1 [scrollbar-width:thin]">
          <div
            v-for="player in players"
            :key="player.id"
            class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 transition-colors"
            :class="activePlayerId === player.id ? 'border-primary/55 bg-primary/10' : 'border-border bg-background'"
            role="button"
            tabindex="0"
            @click="emit('select-player', player.id)"
            @keydown.enter.self.prevent="emit('select-player', player.id)"
            @keydown.space.self.prevent="emit('select-player', player.id)"
          >
            <input
              v-model="player.name"
              class="w-[72px] bg-transparent text-xs font-semibold outline-none"
              :aria-label="t('common:player', 'Player')"
              @click.stop
              @focus="emit('select-player', player.id)"
            />
            <input
              v-model="player.selected"
              type="checkbox"
              class="size-3.5 accent-primary"
              :aria-label="t('common:vue.app.simToggle', 'Sim')"
              @click.stop
            />
          </div>
        </div>

        <div class="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground xl:flex">
          <span
            >{{ t('common:queue.queueList', 'Queue List') }}
            <strong class="text-foreground">{{ itemCount }}</strong></span
          >
          <span
            >{{ t('common:vue.queue.queueProgress', 'Queue Progress') }}
            <strong class="text-foreground">{{ queueProgressText }}</strong></span
          >
        </div>
      </div>

      <p v-if="partySummaryText" class="text-xs text-muted-foreground">
        {{ t('common:queue.partyLockedMembers', 'Locked party') }}:
        <strong class="text-foreground">{{ partySummaryText }}</strong>
      </p>
      <p v-if="actionStatusText" class="text-xs" :class="actionStatusClass">{{ actionStatusText }}</p>
      <p v-if="partyWarningText" class="text-xs text-warning">{{ partyWarningText }}</p>
      <div v-if="showRuntimeSummary" class="flex items-center gap-3 border-t border-border pt-2">
        <span class="shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">{{
          t('common:vue.app.runtime', 'Runtime')
        }}</span>
        <Progress class="min-w-20 flex-1" :value="runtimeProgress * 100" />
        <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ progressLabel }}</span>
        <Button
          v-if="runtimeError"
          type="button"
          variant="ghost"
          size="sm"
          class="text-destructive"
          @click="emit('view-error', runtimeError)"
        >
          <CircleAlert />{{ t('common:vue.app.viewErrorDetails', 'Details') }}
        </Button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { CircleAlert, Ellipsis, Gauge, ListPlus, Play, Square, Trash2 } from '@lucide/vue';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui';
import { Button } from '@/ui/components/ui/button/index.js';
import { Progress } from '@/ui/components/ui/progress/index.js';
import { useI18nText } from '../composables/useI18nText.js';

defineProps({
  players: { type: Array, default: () => [] },
  activePlayerId: { type: [String, Number], default: '' },
  queueActionsDisabled: { type: Boolean, default: false },
  hasBaseline: { type: Boolean, default: false },
  partyMismatch: { type: Boolean, default: false },
  itemCount: { type: Number, default: 0 },
  queueProgressText: { type: String, default: '0%' },
  partySummaryText: { type: String, default: '' },
  partyWarningText: { type: String, default: '' },
  actionStatusText: { type: String, default: '' },
  actionStatusClass: { type: String, default: '' },
  showSimulationActions: { type: Boolean, default: false },
  simulationRunning: { type: Boolean, default: false },
  simulationActionsDisabled: { type: Boolean, default: false },
  showRuntimeSummary: { type: Boolean, default: false },
  runtimeProgress: { type: Number, default: 0 },
  runtimeError: { type: String, default: '' },
  progressLabel: { type: String, default: '' },
});

const emit = defineEmits([
  'set-baseline',
  'add-queue',
  'run-queue',
  'clear-queue',
  'select-player',
  'start-simulation',
  'stop-simulation',
  'height-change',
  'view-error',
]);
const { t } = useI18nText();
const commandBarRoot = ref(null);
let resizeObserver = null;

function reportCommandBarHeight() {
  const element = commandBarRoot.value;
  const height = element ? Math.ceil(element.getBoundingClientRect().height || element.offsetHeight || 0) : 0;
  emit('height-change', height);
}

onMounted(async () => {
  await nextTick();
  reportCommandBarHeight();
  if (typeof ResizeObserver === 'function' && commandBarRoot.value) {
    resizeObserver = new ResizeObserver(reportCommandBarHeight);
    resizeObserver.observe(commandBarRoot.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.command-menu-item {
  display: flex;
  min-height: 2rem;
  cursor: default;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.25rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  outline: none;
}

.command-menu-item[data-highlighted] {
  background: var(--accent);
  color: var(--accent-foreground);
}

.command-menu-item[data-disabled] {
  opacity: 0.45;
}

.command-menu-item :deep(svg) {
  width: 1rem;
  height: 1rem;
}
</style>
