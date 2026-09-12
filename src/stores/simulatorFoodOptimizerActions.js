import {
  loadFoodOptimizerSettingsFromStorage,
  persistFoodOptimizerSettingsToStorage,
} from '../services/simulatorStorage.js';
import {
  createFoodOptimizerInputSignature,
  getFoodOptimizerItems,
  countFoodOptimizerCandidates,
  isValidFoodOptimizerSettings,
  normalizeFoodOptimizerFoodHrids,
} from '../services/foodOptimizerDomain.js';
import { snapshotFoodOptimizerInput } from '../services/foodOptimizerSnapshot.js';
import {
  assertFoodOptimizerTarget,
  FOOD_OPTIMIZER_LABYRINTH_ERROR,
  isFoodOptimizerLabyrinth,
} from '../services/foodOptimizerTarget.js';
import { hasSharedWorkerRunInProgress } from '../services/simulatorWorkerRuns.js';
import { normalizeParallelWorkerLimit } from '../services/queueScoring.js';
import { createCachedModuleLoader } from '../services/cachedModuleLoader.js';
import { createFoodOptimizerReportCache } from '../services/foodOptimizerReportCache.js';
import { deepClone } from '../services/utils.js';
import { effectScope, watch } from 'vue';

const loadOptimizer = createCachedModuleLoader(() => import('../services/foodOptimizerSimulation.js'));
const runs = new WeakMap();
const reportCaches = new WeakMap();
const trackedStores = new WeakSet();
const applyingStores = new WeakSet();

// 归一化后的范围数组按目录顺序排列，可直接用连接串比较。仅作设置变更的
// 比较键：null（未保存范围）与空数组都折叠为空串；默认范围不在本层解析
// （快照层 resolveFoodScopeHrids 负责把 null 解析为装备默认）。
function foodScopeKey(hrids) {
  return Array.isArray(hrids) && hrids.length ? hrids.join('|') : '';
}

function clearLabyrinthPreview(store) {
  store.foodOptimizer.preview = null;
  store.foodOptimizer.previewPending = false;
  store.foodOptimizer.previewError = FOOD_OPTIMIZER_LABYRINTH_ERROR;
}

function trackReportChanges(store) {
  if (trackedStores.has(store)) return;
  trackedStores.add(store);
  const scope = effectScope(true);
  scope.run(() =>
    watch(
      [() => store.foodOptimizerInputSignature, () => store.foodOptimizer.report],
      () => {
        if (applyingStores.has(store)) return;
        const report = store.foodOptimizer.report;
        if (report && store.foodOptimizerReportStale) report.stale = true;
      },
      { flush: 'sync' },
    ),
  );
  const dispose = store.$dispose.bind(store);
  store.$dispose = () => {
    store.stopFoodOptimizer();
    scope.stop();
    trackedStores.delete(store);
    reportCaches.get(store)?.clear();
    reportCaches.delete(store);
    dispose();
  };
}

export function createFoodOptimizerState() {
  return {
    settings: loadFoodOptimizerSettingsFromStorage(),
    preview: null,
    previewError: '',
    previewPending: false,
    runtime: { isRunning: false, runId: 0, phase: 'idle', progress: 0, activeRounds: 0, elapsedSeconds: 0, error: '' },
    report: null,
  };
}

export function foodOptimizerBusy(store) {
  return (
    store.runtime.isRunning ||
    store.isAnyQueueRunning ||
    store.advisor.runtime?.isRunning ||
    store.advisor.runtime?.scanInFlight ||
    store.pricing.isLoading ||
    hasSharedWorkerRunInProgress()
  );
}

export function createFoodOptimizerActions({ loadPlayerMapperModule }) {
  async function prepare(input) {
    assertFoodOptimizerTarget(input);
    const [mapper, optimizer] = await Promise.all([loadPlayerMapperModule(), loadOptimizer()]);
    const payload = { ...input.simulation, players: deepClone(mapper.buildPlayersForSimulation(input.players)) };
    const resources = optimizer.getFoodOptimizerResources({ activePlayerId: input.activePlayerId, payload });
    const items = getFoodOptimizerItems({
      ...resources,
      thresholdStepPercent: input.thresholdStepPercent,
      hrids: input.foodHrids,
      prices: input.prices.priceTable,
      consumableMode: input.prices.consumableMode,
    });
    return { payload, resources, items, totalCandidates: countFoodOptimizerCandidates(items, resources.foodSlots) };
  }
  return {
    setFoodOptimizerSettings(settings) {
      trackReportChanges(this);
      if (this.foodOptimizer.runtime.isRunning) return false;
      const next = { ...this.foodOptimizer.settings, ...settings };
      if (!isValidFoodOptimizerSettings(next)) return false;
      next.foodHrids = normalizeFoodOptimizerFoodHrids(next.foodHrids);
      const supportedTarget = !isFoodOptimizerLabyrinth(snapshotFoodOptimizerInput(this));
      if (!supportedTarget) clearLabyrinthPreview(this);
      const previousPreview =
        supportedTarget && this.foodOptimizer.preview?.inputSignature === this.foodOptimizerInputSignature
          ? this.foodOptimizer.preview
          : null;
      if (
        next.thresholdStepPercent !== this.foodOptimizer.settings.thresholdStepPercent ||
        next.rounds !== this.foodOptimizer.settings.rounds ||
        next.searchMode !== this.foodOptimizer.settings.searchMode ||
        foodScopeKey(next.foodHrids) !== foodScopeKey(this.foodOptimizer.settings.foodHrids)
      ) {
        if (this.foodOptimizer.report) this.foodOptimizer.report.stale = true;
        this.foodOptimizer.settings = persistFoodOptimizerSettingsToStorage(next);
        if (previousPreview) {
          const input = snapshotFoodOptimizerInput(this);
          const items = getFoodOptimizerItems({
            ...previousPreview.resources,
            thresholdStepPercent: input.thresholdStepPercent,
            hrids: input.foodHrids,
            prices: input.prices.priceTable,
            consumableMode: input.prices.consumableMode,
          });
          this.foodOptimizer.preview = {
            ...previousPreview,
            inputSignature: createFoodOptimizerInputSignature(input),
            totalCandidates: countFoodOptimizerCandidates(items, previousPreview.resources.foodSlots),
          };
        }
      }
      return true;
    },
    async refreshFoodOptimizerPreview() {
      trackReportChanges(this);
      if (this.foodOptimizer.runtime.isRunning) return;
      const input = snapshotFoodOptimizerInput(this);
      if (isFoodOptimizerLabyrinth(input)) {
        clearLabyrinthPreview(this);
        return;
      }
      if (this.foodOptimizer.runtime.error === FOOD_OPTIMIZER_LABYRINTH_ERROR) this.foodOptimizer.runtime.error = '';
      const signature = createFoodOptimizerInputSignature(input);
      if (this.foodOptimizer.preview?.inputSignature === signature) return;
      this.foodOptimizer.previewPending = true;
      this.foodOptimizer.previewError = '';
      this.foodOptimizer.preview = null;
      try {
        if (!input.imported || input.runScope !== 'single' || !isValidFoodOptimizerSettings(input)) return;
        const prepared = await prepare(input);
        if (this.foodOptimizerInputSignature === signature && !this.foodOptimizer.runtime.isRunning) {
          this.foodOptimizer.preview = {
            inputSignature: signature,
            resources: prepared.resources,
            totalCandidates: prepared.totalCandidates,
          };
        }
      } catch (error) {
        if (this.foodOptimizerInputSignature === signature)
          this.foodOptimizer.previewError = error?.message || String(error);
      } finally {
        if (isFoodOptimizerLabyrinth(snapshotFoodOptimizerInput(this))) clearLabyrinthPreview(this);
        else if (this.foodOptimizerInputSignature === signature) this.foodOptimizer.previewPending = false;
      }
    },
    async startFoodOptimizer() {
      trackReportChanges(this);
      if (this.foodOptimizer.runtime.isRunning) return;
      const runtime = this.foodOptimizer.runtime;
      runtime.error = '';
      const input = snapshotFoodOptimizerInput(this);
      if (isFoodOptimizerLabyrinth(input)) {
        clearLabyrinthPreview(this);
        runtime.error = FOOD_OPTIMIZER_LABYRINTH_ERROR;
        return;
      }
      if (foodOptimizerBusy(this)) {
        runtime.error = 'common:foodOptimizer.busy';
        return;
      }
      if (!input.imported) {
        runtime.error = 'common:foodOptimizer.requireImport';
        return;
      }
      if (input.runScope !== 'single') {
        runtime.error = 'common:foodOptimizer.requireSingle';
        return;
      }
      if (!isValidFoodOptimizerSettings(input)) {
        runtime.error = 'common:foodOptimizer.invalidSettings';
        return;
      }
      const inputSignature = createFoodOptimizerInputSignature(input);
      const runId = runtime.runId + 1;
      Object.assign(runtime, {
        isRunning: true,
        runId,
        phase: 'preparing',
        progress: 0,
        activeRounds: 0,
        elapsedSeconds: 0,
      });
      const active = () => runtime.runId === runId && runtime.isRunning;
      let reportPublished = false;
      let staleDuringRun = false;
      const acceptReport = (report) => {
        staleDuringRun ||=
          this.foodOptimizerInputSignature !== inputSignature ||
          (reportPublished && Boolean(this.foodOptimizer.report?.stale));
        report.stale ||= staleDuringRun;
        this.foodOptimizer.report = report;
        reportPublished = true;
      };
      try {
        const cached = reportCaches.get(this)?.get(inputSignature);
        if (cached) {
          if (!active()) return;
          assertFoodOptimizerTarget(snapshotFoodOptimizerInput(this));
          acceptReport(cached);
          // Report statistics describe the original computation. The page
          // explicitly labels this reuse; this request performs no new rounds.
          Object.assign(runtime, { phase: 'completed', progress: 1, activeRounds: 0, elapsedSeconds: 0 });
          return;
        }
        const prepared = await prepare(input);
        if (!active()) return;
        assertFoodOptimizerTarget(snapshotFoodOptimizerInput(this));
        const { createFoodOptimizerSearch } = await import('../services/foodOptimizerSearch.js');
        if (!active()) return;
        assertFoodOptimizerTarget(snapshotFoodOptimizerInput(this));
        const request = {
          ...input,
          payload: prepared.payload,
          resources: prepared.resources,
          inputSignature,
          seeds: Array.from({ length: input.rounds }, (_, index) => (0x4d574946 + Math.imul(index, 0x9e3779b9)) >>> 0),
        };
        const search = createFoodOptimizerSearch({
          request,
          items: prepared.items,
          foodSlots: prepared.resources.foodSlots,
          workerLimit: normalizeParallelWorkerLimit(
            this.queueRuntime.parallelWorkerLimit,
            this.queueParallelWorkerHardMax,
          ),
          onUpdate: (report, progress) => {
            if (runtime.runId !== runId) return;
            acceptReport(report);
            Object.assign(runtime, progress);
          },
        });
        runs.set(this, search);
        const report = await search.done;
        if (runtime.runId === runId) {
          acceptReport(report);
          runtime.phase = report.status;
          runtime.error = report.error || '';
          let cache = reportCaches.get(this);
          if (!cache) reportCaches.set(this, (cache = createFoodOptimizerReportCache()));
          cache.record(inputSignature, report);
        }
      } catch (error) {
        if (active()) {
          runtime.error = error?.message || String(error);
          runtime.phase = 'error';
        }
      } finally {
        if (runtime.runId === runId) {
          runtime.isRunning = false;
          runs.delete(this);
        }
      }
    },
    stopFoodOptimizer() {
      if (!this.foodOptimizer.runtime.isRunning) return;
      const search = runs.get(this);
      if (search) search.cancel();
      else {
        this.foodOptimizer.runtime.runId += 1;
        this.foodOptimizer.runtime.isRunning = false;
        this.foodOptimizer.runtime.phase = 'cancelled';
      }
    },
    applyFoodOptimizerResult(signature) {
      trackReportChanges(this);
      const report = this.foodOptimizer.report;
      if (!report || this.foodOptimizer.runtime.isRunning || foodOptimizerBusy(this)) return false;
      if (isFoodOptimizerLabyrinth(report.request) || isFoodOptimizerLabyrinth(snapshotFoodOptimizerInput(this))) {
        this.foodOptimizer.runtime.error = FOOD_OPTIMIZER_LABYRINTH_ERROR;
        return false;
      }
      if (this.foodOptimizerReportStale) {
        this.foodOptimizer.runtime.error = 'common:foodOptimizer.stale';
        return false;
      }
      const result = report.topResults.find((entry) => entry.signature === signature);
      if (!result?.feasible || result.roundsCompleted !== report.request.rounds) return false;
      const player = this.players.find((entry) => String(entry.id) === report.request.activePlayerId);
      if (!player) return false;
      applyingStores.add(this);
      try {
        this.$patch(() => {
          player.food = Array.from({ length: 3 }, (_, index) => result.food[index] || '');
          player.triggerMap = { ...player.triggerMap, ...deepClone(result.triggerMap) };
          report.appliedSignature = signature;
          report.appliedInputSignature = createFoodOptimizerInputSignature(snapshotFoodOptimizerInput(this));
        });
      } finally {
        applyingStores.delete(this);
      }
      return true;
    },
  };
}
