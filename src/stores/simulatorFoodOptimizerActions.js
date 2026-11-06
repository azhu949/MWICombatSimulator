import {
  loadFoodOptimizerSettingsFromStorage,
  persistFoodOptimizerSettingsToStorage,
} from '../services/simulatorStorage.js';
import {
  buildFoodOptimizerLockedItems,
  createFoodOptimizerInputSignature,
  getFoodOptimizerItems,
  countFoodOptimizerCandidates,
  isValidFoodOptimizerSettings,
  normalizeFoodOptimizerFoodHrids,
  normalizeFoodOptimizerLockedFoodHrids,
} from '../services/foodOptimizerDomain.js';
import { snapshotFoodOptimizerInput } from '../services/foodOptimizerSnapshot.js';
import {
  assertFoodOptimizerTarget,
  FOOD_OPTIMIZER_LABYRINTH_ERROR,
  isFoodOptimizerLabyrinth,
} from '../services/foodOptimizerTarget.js';
import { hasSharedWorkerRunInProgress } from '../services/simulatorWorkerRuns.js';
import { hasBudgetOptimizerRunInProgress } from '../services/budgetOptimizerRunRegistry.js';
import { normalizeParallelWorkerLimit } from '../services/queueScoring.js';
import { createCachedModuleLoader } from '../services/cachedModuleLoader.js';
import { createFoodOptimizerReportCache } from '../services/foodOptimizerReportCache.js';
import { deepClone } from '../services/utils.js';
import { effectScope, toRaw, watch } from 'vue';

const loadOptimizer = createCachedModuleLoader(() => import('../services/foodOptimizerSimulation.js'));
const runs = new WeakMap();
const reportCaches = new WeakMap();
const trackedStores = new WeakSet();
const applyingStores = new WeakSet();

// WeakSet 的键取 store 的**原始对象**（toRaw）而不是 action 里的 this：Pinia 的
// devtools 插件（dev 下对 options store 生效）会给每次 action 调用传一个新建的
// `new Proxy(store)` 当 this，身份键因此永不命中——注册去重与遮蔽会同时失效
//（同 simulatorTriggerOptimizerActions 的 storeKey，2026-09-17 定案）。
function storeKey(store) {
  return toRaw(store);
}

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
  const key = storeKey(store);
  if (trackedStores.has(key)) return;
  trackedStores.add(key);
  const scope = effectScope(true);
  scope.run(() =>
    watch(
      [() => store.foodOptimizerInputSignature, () => store.foodOptimizer.report],
      () => {
        if (applyingStores.has(key)) return;
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
    trackedStores.delete(key);
    reportCaches.get(key)?.clear();
    reportCaches.delete(key);
    dispose();
  };
}

export function createFoodOptimizerState() {
  return {
    settings: loadFoodOptimizerSettingsFromStorage(),
    // 锁定属于当前配置工作流，不进旧设置存档；实际生效集合由快照与当前装备求交集。
    lockedFoodHrids: [],
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
    store.triggerOptimizer?.runtime?.isRunning ||
    // 预算优化器（2026-10-04 登记）：与食物优化器同抢 worker 池，运行时禁止开跑
    //（store 运行态 + 模块级注册表双查，与 trigger 的登记同款）。
    store.budgetOptimizer?.runtime?.isRunning ||
    hasBudgetOptimizerRunInProgress() ||
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
    const equippedFood = payload.players.find((player) => player.hrid === `player${input.activePlayerId}`)?.food;
    // 固定轴单独从完整目录构造，不继承「可变食物范围」；快照已把锁定食物并入范围，
    // 这里的独立构造同时保护直接调用方不因其范围过滤而丢失锁定项。
    const lockedCatalog = input.lockedFoodHrids?.length
      ? getFoodOptimizerItems({
          ...resources,
          thresholdStepPercent: input.thresholdStepPercent,
          hrids: input.lockedFoodHrids,
          prices: input.prices.priceTable,
          consumableMode: input.prices.consumableMode,
        })
      : [];
    const lockedItems = buildFoodOptimizerLockedItems(lockedCatalog, input.lockedFoodHrids, equippedFood);
    if (lockedItems.length && lockedItems.length >= resources.foodSlots)
      throw new Error('common:foodOptimizer.lockAtLeastOne');
    // 当前阈值可以不在本次步长网格上（例如从 10% 切到 25% 后保留旧配置）；仍须加入
    // 共享网格，固定轴才能继续使用轮次缓存。候选枚举仍只读 lockedItems 的单阈值轴。
    const lockedByHrid = new Map(lockedItems.map((item) => [item.hrid, item]));
    const searchItems = lockedItems.length
      ? items.map((item) => {
          const locked = lockedByHrid.get(item.hrid);
          return locked
            ? { ...item, thresholds: [...new Set([...item.thresholds, ...locked.thresholds])].sort((a, b) => b - a) }
            : item;
        })
      : items;
    const totalCandidates = countFoodOptimizerCandidates(searchItems, resources.foodSlots, lockedItems);
    if (lockedItems.length && totalCandidates <= 1) {
      const error = new Error('common:foodOptimizer.unlockedFoodRequired');
      // 范围可修复的校验失败仍发布有效资源与候选数，供页面打开范围弹窗补选。
      error.foodOptimizerPreview = { resources, totalCandidates };
      throw error;
    }
    return { payload, resources, items: searchItems, lockedItems, totalCandidates };
  }
  return {
    setFoodOptimizerLockedFoods(hrids) {
      trackReportChanges(this);
      if (this.foodOptimizer.runtime.isRunning) return false;
      const equipped = new Set((this.activePlayer?.food || []).filter(Boolean).map((hrid) => String(hrid)));
      const current = new Set(
        normalizeFoodOptimizerLockedFoodHrids(this.foodOptimizer.lockedFoodHrids).filter((hrid) => equipped.has(hrid)),
      );
      const next = normalizeFoodOptimizerLockedFoodHrids(hrids).filter((hrid) => equipped.has(hrid));
      if (foodScopeKey(next) === foodScopeKey(this.foodOptimizer.lockedFoodHrids)) return true;
      const previousPreview =
        this.foodOptimizer.preview?.inputSignature === this.foodOptimizerInputSignature
          ? this.foodOptimizer.preview
          : null;
      const foodSlots = previousPreview?.resources?.foodSlots;
      // 解锁始终可用；新增锁定必须依据当前实际槽位，资源未知时不能回退到全局三槽。
      const hasAddedLock = next.some((hrid) => !current.has(hrid));
      if (hasAddedLock && (!Number.isSafeInteger(foodSlots) || foodSlots < 1 || next.length >= foodSlots)) return false;
      this.foodOptimizer.lockedFoodHrids = next;
      // 仅锁定变化不会改变角色资源；保留同签名链上的实际槽位，但候选数必须重新准备。
      this.foodOptimizer.preview = previousPreview
        ? {
            inputSignature: this.foodOptimizerInputSignature,
            resources: previousPreview.resources,
            totalCandidates: null,
            resourcesOnly: true,
          }
        : null;
      this.foodOptimizer.previewPending = false;
      this.foodOptimizer.previewError = '';
      this.foodOptimizer.runtime.error = '';
      if (this.foodOptimizer.report) this.foodOptimizer.report.stale = true;
      return true;
    },
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
        next.requireZeroDeaths !== this.foodOptimizer.settings.requireZeroDeaths ||
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
            totalCandidates: countFoodOptimizerCandidates(
              items,
              previousPreview.resources.foodSlots,
              (input.lockedFoodHrids || []).map((hrid) => ({ hrid, thresholds: [1] })),
            ),
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
      if (
        this.foodOptimizer.preview?.inputSignature === signature &&
        !this.foodOptimizer.preview.resourcesOnly &&
        !this.foodOptimizer.previewError
      )
        return;
      const retainedPreview =
        this.foodOptimizer.preview?.resourcesOnly && this.foodOptimizer.preview.inputSignature === signature
          ? this.foodOptimizer.preview
          : null;
      this.foodOptimizer.previewPending = true;
      this.foodOptimizer.previewError = '';
      this.foodOptimizer.preview = retainedPreview;
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
        if (this.foodOptimizerInputSignature === signature) {
          if (error?.foodOptimizerPreview) {
            this.foodOptimizer.preview = {
              ...error.foodOptimizerPreview,
              inputSignature: signature,
            };
          }
          this.foodOptimizer.previewError = error?.message || String(error);
        }
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
      this.foodOptimizer.previewError = '';
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
        const cached = reportCaches.get(storeKey(this))?.get(inputSignature);
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
          lockedItems: prepared.lockedItems,
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
        runs.set(storeKey(this), search);
        const report = await search.done;
        if (runtime.runId === runId) {
          acceptReport(report);
          runtime.phase = report.status;
          runtime.error = report.error || '';
          let cache = reportCaches.get(storeKey(this));
          if (!cache) reportCaches.set(storeKey(this), (cache = createFoodOptimizerReportCache()));
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
          runs.delete(storeKey(this));
        }
      }
    },
    stopFoodOptimizer() {
      if (!this.foodOptimizer.runtime.isRunning) return;
      const search = runs.get(storeKey(this));
      if (search) search.cancel();
      else {
        this.foodOptimizer.runtime.runId += 1;
        this.foodOptimizer.runtime.isRunning = false;
        this.foodOptimizer.runtime.phase = 'cancelled';
      }
    },
    applyFoodOptimizerResult(signature, { force = false } = {}) {
      trackReportChanges(this);
      const report = this.foodOptimizer.report;
      if (!report || this.foodOptimizer.runtime.isRunning || foodOptimizerBusy(this)) return false;
      if (isFoodOptimizerLabyrinth(report.request) || isFoodOptimizerLabyrinth(snapshotFoodOptimizerInput(this))) {
        this.foodOptimizer.runtime.error = FOOD_OPTIMIZER_LABYRINTH_ERROR;
        return false;
      }
      // 「输入已变化」默认拒绝仍是 store 层防线；页面在 stale 时先弹确认框，
      // 用户选择「仍要应用」后以 force 绕过本门禁（迷宫守卫不受 force 影响）。
      if (!force && this.foodOptimizerReportStale) {
        this.foodOptimizer.runtime.error = 'common:foodOptimizer.stale';
        return false;
      }
      const result = report.topResults.find((entry) => entry.signature === signature);
      if (!result?.feasible || result.roundsCompleted !== report.request.rounds) return false;
      const player = this.players.find((entry) => String(entry.id) === report.request.activePlayerId);
      if (!player) return false;
      applyingStores.add(storeKey(this));
      try {
        this.$patch(() => {
          player.food = Array.from({ length: 3 }, (_, index) => result.food[index] || '');
          player.triggerMap = { ...player.triggerMap, ...deepClone(result.triggerMap) };
          report.appliedSignature = signature;
          report.appliedInputSignature = createFoodOptimizerInputSignature(snapshotFoodOptimizerInput(this));
        });
      } finally {
        applyingStores.delete(storeKey(this));
      }
      return true;
    },
  };
}
