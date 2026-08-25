<template>
  <BaseModal
    :open="open"
    :title="t('common:Experiment.ExperimentalFeatures', 'Experimental Features')"
    @close="closeModal"
  >
    <div class="space-y-3">
      <div class="rounded-md border border-border bg-muted/50 p-3">
        <label class="status-chip flex items-center justify-between gap-3 text-sm text-foreground">
          <span>{{ t('common:Experiment.enableHpMpVisualization', 'Enable HP/MP Timeline Charts') }}</span>
          <input v-model="simulator.simulationSettings.enableHpMpVisualization" type="checkbox" />
        </label>
      </div>

      <div class="rounded-md border border-border bg-muted/50 p-3">
        <p class="control-label">
          {{ t('common:Experiment.batchSimFromJson', 'Run batch simulations from JSON files') }}
        </p>
        <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input
            ref="fileInput"
            class="control-input"
            type="file"
            accept="application/json,.json,.txt"
            @change="onFileSelected"
          />
          <button type="button" class="button-primary" :disabled="!fileReady || running" @click="runBatch">
            {{ t('common:Experiment.uploadAndRun', 'Upload & Run') }}
          </button>
          <button v-if="running" type="button" class="button-danger" @click="cancelBatch">
            {{ t('common:vue.common.cancel', 'Cancel') }}
          </button>
          <button v-if="fileReady && !running" type="button" class="button-secondary" @click="clearSelectedFile">
            {{ t('common:vue.common.clear', 'Clear') }}
          </button>
          <button type="button" class="button-secondary" :disabled="!downloadText || running" @click="downloadResults">
            {{ t('common:Experiment.download', 'Download Results') }}
          </button>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">{{ statusText }}</p>
      </div>

      <div class="rounded-md border border-border bg-muted/50 p-3">
        <p class="control-label">{{ t('common:Experiment.dungeonStartWave', 'Dungeon Start Wave') }}</p>
        <div class="flex items-center gap-3">
          <label class="status-chip flex items-center gap-2">
            <input v-model="dungeonStartWaveEnabled" type="checkbox" />
            {{ t('common:Experiment.dungeonStartWave', 'Dungeon Start Wave') }}
          </label>
          <input
            v-model.number="dungeonStartWave"
            class="control-input max-w-[120px]"
            type="number"
            min="1"
            max="100"
            :disabled="!dungeonStartWaveEnabled"
          />
          <span class="text-xs text-muted-foreground">{{ t('common:Experiment.wave', 'Wave') }}</span>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          {{
            t('common:Experiment.dungeonStartWaveNotConnected', 'Start wave is not connected to worker runtime yet.')
          }}
        </p>
      </div>
    </div>
  </BaseModal>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import {
  DEDICATED_WORKER_SCOPE_EXPERIMENTAL,
  isWorkerRunCancelledError,
} from '../../../services/simulatorWorkerRuns.js';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useI18nText } from '../../composables/useI18nText.js';
import BaseModal from '../BaseModal.vue';

defineProps({ open: { type: Boolean, default: false } });
const emit = defineEmits(['close']);

const simulator = useSimulatorStore();
const { t } = useI18nText();
const fileInput = ref(null);
const selectedFile = ref(null);
const fileReady = ref(false);
const running = ref(false);
const statusText = ref(t('common:Experiment.statusIdle', '-'));
const downloadText = ref('');
const dungeonStartWaveEnabled = ref(false);
const dungeonStartWave = ref(1);
let batchRunId = 0;
let activeWorkerRunId = 0;
let activeWorkerRunHandle = null;

function onFileSelected(event) {
  const input = event?.target;
  try {
    const file = input?.files?.[0] || null;
    selectedFile.value = file;
    fileReady.value = Boolean(file);
    statusText.value = file
      ? t('common:Experiment.statusFileReady', 'Selected file: {{name}}', { name: file.name })
      : t('common:Experiment.statusIdle', '-');
  } finally {
    if (input) {
      input.value = '';
    }
  }
}

function clearSelectedFile() {
  selectedFile.value = null;
  fileReady.value = false;
  if (fileInput.value) {
    fileInput.value.value = '';
  }
  statusText.value = t('common:Experiment.statusIdle', '-');
}

function cancelBatch() {
  if (!running.value) {
    return;
  }

  const cancelledRunId = batchRunId;
  batchRunId += 1;
  if (activeWorkerRunId === cancelledRunId) {
    const workerRunHandle = activeWorkerRunHandle;
    activeWorkerRunHandle = null;
    activeWorkerRunId = 0;
    workerRunHandle?.cancel();
  }
  running.value = false;
  statusText.value = t('common:Experiment.statusCancelled', 'Cancelled.');
}

function closeModal() {
  cancelBatch();
  emit('close');
}

async function runBatch() {
  if (running.value) {
    return;
  }

  const file = selectedFile.value;
  if (!file) {
    statusText.value = t('common:Experiment.statusNoFile', 'No file selected.');
    return;
  }

  const runId = ++batchRunId;
  running.value = true;
  downloadText.value = '';

  try {
    const parsed = JSON.parse(await file.text());
    if (runId !== batchRunId) {
      return;
    }

    const cases = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.cases)
        ? parsed.cases
        : Object.values(parsed || {});
    const results = [];

    for (let i = 0; i < cases.length; i += 1) {
      if (runId !== batchRunId) {
        return;
      }

      const entry = cases[i] || {};
      const players = Array.isArray(entry.players) ? entry.players : [];
      if (players.length === 0) {
        continue;
      }

      const payload = {
        type: 'start_simulation',
        workerId: `${Date.now()}-${i}`,
        players,
        zone:
          entry.zone ||
          (entry.zoneHrid ? { zoneHrid: entry.zoneHrid, difficultyTier: Number(entry.difficultyTier || 0) } : null),
        labyrinth: entry.labyrinth || null,
        simulationTimeLimit: Number(entry.simulationTimeLimit || 24 * 60 * 60 * 1e9),
        extra: {
          // 批处理场景使用中立的 worker 默认值，而非继承本地 UI 增益，
          // 这样同一份 JSON 文件在不同安装环境下会产生相同结果。
          mooPass: Boolean(entry?.extra?.mooPass),
          comExp: Number(entry?.extra?.comExp ?? 0),
          comDrop: Number(entry?.extra?.comDrop ?? 0),
          enableHpMpVisualization: Boolean(entry?.extra?.enableHpMpVisualization),
          dungeonStartWaveEnabled: Boolean(dungeonStartWaveEnabled.value),
          dungeonStartWave: Number(dungeonStartWave.value || 1),
        },
      };

      activeWorkerRunId = runId;
      let simResult;
      try {
        // 有意逐个 await 每个用例，使实验批处理最多只使用一个专属 worker。
        simResult = await simulator.runSingleSimulationPayloadWithDedicatedWorker(payload, undefined, {
          scope: DEDICATED_WORKER_SCOPE_EXPERIMENTAL,
          onHandle: (workerRunHandle) => {
            if (runId === batchRunId) {
              activeWorkerRunHandle = workerRunHandle;
            }
          },
        });
      } finally {
        if (activeWorkerRunId === runId) {
          activeWorkerRunId = 0;
          activeWorkerRunHandle = null;
        }
      }

      if (runId !== batchRunId) {
        return;
      }

      results.push({
        name: String(entry.name || `case-${i + 1}`),
        input: entry,
        simResult,
      });
      statusText.value = t('common:Experiment.statusRunning', 'Running {{current}} / {{total}}', {
        current: i + 1,
        total: cases.length,
      });
    }

    downloadText.value = JSON.stringify(
      {
        generatedAt: Date.now(),
        total: results.length,
        dungeonStartWaveEnabled: dungeonStartWaveEnabled.value,
        dungeonStartWave: dungeonStartWave.value,
        results,
      },
      null,
      2,
    );
    statusText.value = t('common:Experiment.statusCompleted', 'Completed {{count}} cases.', {
      count: results.length,
    });
  } catch (error) {
    if (runId !== batchRunId) {
      return;
    }
    statusText.value = isWorkerRunCancelledError(error)
      ? t('common:Experiment.statusCancelled', 'Cancelled.')
      : t('common:Experiment.statusFailed', 'Failed: {{error}}', { error: error?.message || String(error) });
  } finally {
    if (runId === batchRunId) {
      running.value = false;
    }
  }
}

function downloadResults() {
  if (!downloadText.value) {
    return;
  }

  const url = URL.createObjectURL(new Blob([downloadText.value], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `mwi-experimental-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

watch(
  () => simulator.simulationSettings.enableHpMpVisualization,
  () => simulator.persistSimulationUiSettings(),
);

onBeforeUnmount(cancelBatch);
</script>
