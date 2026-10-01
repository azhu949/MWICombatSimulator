import {
  RUN_SCOPE_ALL_GROUP_ZONES,
  RUN_SCOPE_ALL_LABYRINTHS,
  RUN_SCOPE_ALL_SOLO_ZONES,
  RUN_SCOPE_SINGLE,
  ONE_HOUR,
  buildAllLabyrinthTargets,
  buildSimulationExtra,
  buildSingleSimulationPayload as buildSimulationPayload,
  buildZoneTargetsByScope,
  normalizeLabyrinthCrates,
  normalizeZoneSelection,
  summarizeBatchResults,
  summarizeResult,
} from '../services/simulationDomain.js';
import { normalizeLabyrinthShopUpgrades } from '../shared/labyrinthShopUpgrades.js';
import {
  HOME_MULTI_ROUND_SEED_BASE,
  aggregateMultiRoundRows,
  buildMultiRoundPayloads,
  clampSimulationRounds,
} from '../services/homeMultiRoundSimulation.js';
import { deriveSeedSet } from '../services/seededRandom.js';
import { normalizeParallelWorkerLimit } from '../services/queueScoring.js';
import { createProfitPricingOptions, persistSimulationUiSettingsToStorage } from '../services/simulatorStorage.js';
import {
  cancelSharedWorkerRun,
  DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
  hasHomeMultiRoundWorkerRunInProgress,
  hasSharedWorkerRunInProgress,
  isWorkerRunCancelledError,
  runSharedSingleSimulationPayload,
  runSimulationBatchWithDedicatedWorker,
  runSingleSimulationPayloadWithDedicatedWorker,
  stopHomeMultiRoundWorkerRuns,
  stopQueueWorkerClients,
  stopTriggerOptimizerWorkerRuns,
} from '../services/simulatorWorkerRuns.js';
import { clamp, toFiniteNumber } from '../services/utils.js';

// 运行期失败上报的 error 可能是 worker 结构化克隆传回的 Error 实例（worker.js 的
// simulation_error 直接携带 new Error(...)）：JSON.stringify(Error) 输出 '{}'（message
// 是不可枚举属性），全局错误弹窗会只剩花括号。与 queue 路径的 formatQueueErrorMessage
// 同款口径：字符串原样、Error 取 message、其余序列化兜底。
function formatSimulationRunError(error, fallback = 'Simulation failed.') {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error?.message) {
    return String(error.message);
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== 'null' ? serialized : fallback;
  } catch {
    return fallback;
  }
}

export function createSimulationActions({ loadPlayerMapperModule, workerClient }) {
  return {
    buildSingleSimulationPayload(playersToSim, options = {}) {
      const payloadOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
      const simulationSettings = payloadOptions.simulationSettings || this.simulationSettings;
      if (!payloadOptions.simulationSettings) {
        this.normalizeDifficulty();
      }
      return buildSimulationPayload(
        playersToSim,
        simulationSettings,
        payloadOptions.activeLabyrinthCrates ?? this.getActiveLabyrinthCrates(),
        payloadOptions,
      );
    },
    runSingleSimulationPayload(payload, onProgress = () => {}, options = {}) {
      return runSharedSingleSimulationPayload(payload, onProgress, options);
    },
    runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
      return runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress, options);
    },
    // 批量入口（一个 realm 跑完全部 payload）：首页多轮模拟使用；测试可覆盖此 action
    // 注入 WorkerClientCtor 桩（与 runSingleSimulationPayload* 的既有覆盖先例一致）。
    runSimulationBatchPayloads(payloads, onProgress = () => {}, options = {}) {
      return runSimulationBatchWithDedicatedWorker(payloads, onProgress, options);
    },
    setSimulationMode(mode) {
      this.simulationSettings.mode = mode === 'labyrinth' ? 'labyrinth' : 'zone';
      this.normalizeRunScope();
      this.normalizeDifficulty();
    },
    setRunScope(scope) {
      this.simulationSettings.runScope = String(scope || RUN_SCOPE_SINGLE);
      this.normalizeRunScope();
    },
    normalizeBatchSelections() {
      const groupHrids = this.groupZoneOptions.map((zone) => String(zone.hrid || ''));
      const soloHrids = this.soloZoneOptions.map((zone) => String(zone.hrid || ''));
      this.simulationSettings.selectedGroupZoneHrids = normalizeZoneSelection(
        this.simulationSettings.selectedGroupZoneHrids,
        groupHrids,
      );
      this.simulationSettings.selectedSoloZoneHrids = normalizeZoneSelection(
        this.simulationSettings.selectedSoloZoneHrids,
        soloHrids,
      );
      this.simulationSettings.labyrinthCrates = normalizeLabyrinthCrates(this.simulationSettings.labyrinthCrates);
      this.simulationSettings.labyrinthUpgrades = normalizeLabyrinthShopUpgrades(
        this.simulationSettings.labyrinthUpgrades,
      );
    },
    setSelectedGroupZoneHrids(hrids = []) {
      const allHrids = this.groupZoneOptions.map((zone) => String(zone.hrid || ''));
      this.simulationSettings.selectedGroupZoneHrids = normalizeZoneSelection(hrids, allHrids);
    },
    setSelectedSoloZoneHrids(hrids = []) {
      const allHrids = this.soloZoneOptions.map((zone) => String(zone.hrid || ''));
      this.simulationSettings.selectedSoloZoneHrids = normalizeZoneSelection(hrids, allHrids);
    },
    toggleSelectedGroupZoneHrid(zoneHrid, checked) {
      const hrid = String(zoneHrid || '');
      if (!hrid) {
        return;
      }
      const current = new Set(this.simulationSettings.selectedGroupZoneHrids || []);
      if (checked) {
        current.add(hrid);
      } else {
        current.delete(hrid);
      }
      this.setSelectedGroupZoneHrids(Array.from(current));
    },
    toggleSelectedSoloZoneHrid(zoneHrid, checked) {
      const hrid = String(zoneHrid || '');
      if (!hrid) {
        return;
      }
      const current = new Set(this.simulationSettings.selectedSoloZoneHrids || []);
      if (checked) {
        current.add(hrid);
      } else {
        current.delete(hrid);
      }
      this.setSelectedSoloZoneHrids(Array.from(current));
    },
    setLabyrinthCrate(crateType, itemHrid) {
      const normalized = normalizeLabyrinthCrates({
        ...this.simulationSettings.labyrinthCrates,
        [crateType]: itemHrid,
      });
      this.simulationSettings.labyrinthCrates = normalized;
    },
    setLabyrinthUpgrade(upgradeKey, level) {
      const normalized = normalizeLabyrinthShopUpgrades({
        ...this.simulationSettings.labyrinthUpgrades,
        [upgradeKey]: level,
      });
      this.simulationSettings.labyrinthUpgrades = normalized;
      // 升级等级属「随 UI 设置持久化」口径（simulatorStorage.normalizeSimulationUiSettings）：
      // 离散下拉改动即时落盘，防止刷新后回落；导入路径的落盘在 simulatorStore 导入合并点。
      this.persistSimulationUiSettings();
    },
    getActiveLabyrinthUpgrades() {
      return normalizeLabyrinthShopUpgrades(this.simulationSettings.labyrinthUpgrades);
    },
    getActiveLabyrinthCrates() {
      const crates = this.simulationSettings.labyrinthCrates || {};
      const values = [String(crates.coffee || ''), String(crates.food || ''), String(crates.tea || '')].filter(Boolean);
      return Array.from(new Set(values));
    },
    normalizeSimulationBuffLevels() {
      this.simulationSettings.comExp = clamp(Math.floor(toFiniteNumber(this.simulationSettings.comExp, 20)), 1, 99);
      this.simulationSettings.comDrop = clamp(Math.floor(toFiniteNumber(this.simulationSettings.comDrop, 20)), 1, 99);
    },
    persistSimulationUiSettings() {
      this.normalizeSimulationBuffLevels();
      persistSimulationUiSettingsToStorage(this.simulationSettings);
    },
    normalizeRunScope() {
      const scope = this.simulationSettings.runScope;
      this.normalizeBatchSelections();

      if (this.simulationSettings.mode === 'labyrinth') {
        if (scope !== RUN_SCOPE_SINGLE && scope !== RUN_SCOPE_ALL_LABYRINTHS) {
          this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
        }
        this.simulationSettings.useDungeon = false;
        return;
      }

      if (scope !== RUN_SCOPE_SINGLE && scope !== RUN_SCOPE_ALL_GROUP_ZONES && scope !== RUN_SCOPE_ALL_SOLO_ZONES) {
        this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
      }

      if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
        this.simulationSettings.useDungeon = false;
      }
    },
    normalizeDifficulty() {
      const maxDifficulty = Math.min(5, this.currentMaxDifficulty);
      this.simulationSettings.difficultyTier = clamp(
        Number(this.simulationSettings.difficultyTier || 0),
        0,
        maxDifficulty,
      );
    },
    resetResultsForRun() {
      this.results.simResult = null;
      this.results.simResults = [];
      this.results.summaryRows = [];
      this.results.batchRows = [];
      this.results.batchResultType = '';
      this.results.timeSeriesData = null;
      // 首页多轮聚合随新运行开始整体失效（单轮/批量路径不写该字段，保持 null 即可）。
      this.results.multiRound = null;
      this.syncActiveResultPlayerToActivePlayer(this.activePlayerId);
    },
    stopSimulation() {
      if (this.foodOptimizer?.runtime.isRunning) this.stopFoodOptimizer();
      if (this.triggerOptimizer?.runtime.isRunning) this.stopTriggerOptimizer();
      const queueRunInProgress = this.isAnyQueueRunning;
      const advisorRunInProgress = Boolean(this.advisor.runtime?.isRunning);
      const manualRunInProgress = Boolean(this.runtime.isRunning && !queueRunInProgress && !advisorRunInProgress);

      for (const queueState of Object.values(this.queue.byPlayer)) {
        if (queueState?.isRunning) {
          queueState.cancelRequested = true;
        }
      }
      cancelSharedWorkerRun();
      workerClient.stopSimulation();
      stopQueueWorkerClients();
      stopTriggerOptimizerWorkerRuns();
      stopHomeMultiRoundWorkerRuns();
      if (manualRunInProgress) {
        this.runtime.isRunning = false;
        this.runtime.progress = 0;
        this.runtime.startedAt = 0;
        this.runtime.elapsedSeconds = 0;
        this.runtime.workerMode = 'single';
      }
      if (advisorRunInProgress) {
        this.stopAdvisorScan();
      }
    },
    async startSimulation() {
      this.runtime.error = '';
      this.normalizeRunScope();

      if (this.foodOptimizer?.runtime.isRunning) {
        this.runtime.error = 'common:foodOptimizer.busy';
        return;
      }

      if (this.triggerOptimizer?.runtime.isRunning) {
        this.runtime.error = 'common:triggerOptimizer.busy';
        return;
      }

      if (this.isAnyQueueRunning) {
        this.runtime.error = 'common:simulation.errorQueueInProgress';
        return;
      }

      if (this.advisor.runtime?.isRunning) {
        this.runtime.error = 'common:simulation.errorAdvisorInProgress';
        return;
      }

      if (
        hasSharedWorkerRunInProgress() ||
        hasHomeMultiRoundWorkerRunInProgress() ||
        this.foodOptimizer?.runtime.isRunning ||
        this.triggerOptimizer?.runtime.isRunning
      ) {
        this.runtime.error = 'common:simulation.errorAnotherRunInProgress';
        return;
      }

      const selectedPlayersSnapshot = this.selectedPlayers.map((player) => ({ id: player.id, name: player.name }));

      if (selectedPlayersSnapshot.length === 0) {
        this.runtime.error = 'common:simulation.errorNoPlayer';
        return;
      }

      // 入口段兜底：动态导入/玩家构建失败统一转入 runtime.error（本函数其余
      // 校验失败的同一错误通道：App.vue 的 runtime.error watch → 全局错误弹窗
      // 对 i18n key 翻译 + CombatCommandBar「Details」红字按钮）。此前异常直接
      // 逃逸——调用方为模板事件直连，Vue 仅 console.error，用户端完全静默
      //（且函数开头已清空旧错误，连先前的提示都不剩）。
      let buildPlayersForSimulation;
      try {
        ({ buildPlayersForSimulation } = await loadPlayerMapperModule());
      } catch (loadError) {
        this.runtime.error = 'common:simulation.errorLoadModule';
        return;
      }

      let playersToSim;
      try {
        playersToSim = buildPlayersForSimulation(this.players);
      } catch (buildError) {
        this.runtime.error = 'common:simulation.errorBuildPlayerData';
        return;
      }
      if (playersToSim.length === 0) {
        this.runtime.error = 'common:simulation.errorBuildPlayerData';
        return;
      }

      this.normalizeDifficulty();

      const simulationTimeHours = Math.max(1, Number(this.simulationSettings.simulationTimeHours || 24));
      const simulationTimeLimit = simulationTimeHours * ONE_HOUR;
      const extra = buildSimulationExtra(this.simulationSettings);
      const runScope = this.simulationSettings.runScope;
      const parallelWorkerLimit = normalizeParallelWorkerLimit(
        this.queueRuntime?.parallelWorkerLimit,
        this.queueParallelWorkerHardMax,
      );
      const pricingOptions = createProfitPricingOptions(this.pricing);
      const startedAt = Date.now();

      // 在上面的 await 之后重新检查：共享运行可能在此期间已经开始。
      if (
        hasSharedWorkerRunInProgress() ||
        hasHomeMultiRoundWorkerRunInProgress() ||
        this.foodOptimizer?.runtime.isRunning ||
        this.triggerOptimizer?.runtime.isRunning
      ) {
        this.runtime.error = 'common:simulation.errorAnotherRunInProgress';
        return;
      }

      this.runtime.isRunning = true;
      this.runtime.progress = 0;
      this.runtime.startedAt = startedAt;
      this.runtime.elapsedSeconds = 0;
      this.runtime.workerMode = runScope === RUN_SCOPE_SINGLE ? 'single' : 'multi';
      this.resetResultsForRun();

      const onProgress = (data) => {
        this.runtime.progress = clamp(Number(data.progress || 0), 0, 1);
        this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
        if (data.timeSeriesData) {
          this.results.timeSeriesData = data.timeSeriesData;
        }
      };

      const onError = (error) => {
        this.runtime.isRunning = false;
        this.runtime.error = formatSimulationRunError(error);
      };

      if (runScope === RUN_SCOPE_SINGLE) {
        const rounds = clampSimulationRounds(this.simulationSettings.simulationRounds);

        // 红线：rounds <= 1 完全保持既有单轮语义（共享 worker、不传 seed、单场随机流）。
        if (rounds <= 1) {
          workerClient.startSimulation(this.buildSingleSimulationPayload(playersToSim), {
            onProgress,
            onResult: (simResult) => {
              this.runtime.progress = 1;
              this.runtime.isRunning = false;
              this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
              this.results.simResult = simResult;
              this.results.timeSeriesData = simResult?.timeSeriesData ?? this.results.timeSeriesData;
              this.results.summaryRows = summarizeResult(simResult, selectedPlayersSnapshot, pricingOptions);
              this.syncActiveResultPlayerToActivePlayer(this.activePlayerId);
              this.runtime.completionNoticeId += 1;
            },
            onError,
          });

          return;
        }

        // 多轮（2..100）：克隆单轮 payload、逐轮注入确定性种子，一个专用 realm 跑完全部
        // 轮次（runSimulationBatchWithDedicatedWorker 批量入口，省掉逐轮新建 realm 的固定
        // 开销）；完成后写第 1 个成功轮的明细 + 全部成功轮的稳健聚合（口径对齐队列多轮）。
        // 失败轮从聚合中剔除并计入 failedCount；全部失败走 onError 同款错误通道。
        const seeds = deriveSeedSet(HOME_MULTI_ROUND_SEED_BASE, rounds);
        // 多轮逐轮关闭战斗事件日志（worker 侧默认开启）：wasm 引擎在副本 full-result 下会
        // 生成 wipeEvents 团灭日志，体积可达无日志结果的 10 倍以上（golden 夹具 1.16MB vs
        // 104KB），而整批完整 simResult 会同时驻留主线程直到聚合完成，100 轮存在内存峰值
        // 风险。聚合与利润指标（summarizeResult / estimateNoRngProfit）只读数值字段，不依赖
        // 事件流；同 seed 下关日志不改变任何数值（golden 对账锁定）。需要团灭日志做逐事件
        // 分析时跑单轮（rounds <= 1 路径保持默认开启）。
        const basePayload = this.buildSingleSimulationPayload(playersToSim);
        basePayload.logCombatEvents = false;
        const batchPayloads = buildMultiRoundPayloads(basePayload, rounds, HOME_MULTI_ROUND_SEED_BASE);
        let settledRounds = 0;

        const batchOnProgress = (data) => {
          // 运行中的流式时序（当前轮局部数据）：保留与单轮路径一致的实时曲线行为；
          // 结算后由第 1 个成功轮的完整时序覆盖（若有）。
          if (data?.timeSeriesData) {
            this.results.timeSeriesData = data.timeSeriesData;
          }
          const fraction = clamp(Number(data?.progress || 0), 0, 1);
          onProgress({ progress: clamp((settledRounds + fraction) / rounds, 0, 1) });
        };

        this.runSimulationBatchPayloads(batchPayloads, batchOnProgress, {
          scope: DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
          // 每完成一轮（成功或失败）推进整体进度：批运行上一条结算后才发下一条。
          onItemSettled: () => {
            settledRounds += 1;
            onProgress({ progress: clamp(settledRounds / rounds, 0, 1) });
          },
        })
          .then((batch) => {
            const simResults = Array.isArray(batch?.simResults) ? batch.simResults : [];
            const errors = Array.isArray(batch?.errors) ? batch.errors : [];
            const successfulIndexes = [];
            for (let index = 0; index < batchPayloads.length; index += 1) {
              if (simResults[index] && !errors[index]) {
                successfulIndexes.push(index);
              }
            }

            if (successfulIndexes.length === 0) {
              onError(errors.find((entry) => entry) || 'All simulation rounds failed.');
              return;
            }

            const successfulIndexSet = new Set(successfulIndexes);
            const firstSuccessfulIndex = successfulIndexes[0];
            const perRoundRows = successfulIndexes.map((index) =>
              summarizeResult(simResults[index], selectedPlayersSnapshot, pricingOptions),
            );
            const { aggregatedRows, playerStats } = aggregateMultiRoundRows(
              perRoundRows,
              successfulIndexes.map((index) => index + 1),
            );

            this.runtime.progress = 1;
            this.runtime.isRunning = false;
            this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
            this.results.simResult = simResults[firstSuccessfulIndex];
            this.results.timeSeriesData =
              simResults[firstSuccessfulIndex]?.timeSeriesData ?? this.results.timeSeriesData;
            this.results.summaryRows = aggregatedRows;
            this.results.multiRound = {
              // clamp 后的实际轮数 + 固定基种子：相同输入配置 + 相同轮数复现同一组种子。
              rounds,
              // 首个成功轮的 1-based 轮号：上方明细/时序取自该轮，首轮失败时会大于 1，
              // 页面「基于第 N 轮」标注必须读这里，不能写死 1。
              firstSuccessfulRound: firstSuccessfulIndex + 1,
              seedBase: HOME_MULTI_ROUND_SEED_BASE,
              seeds: [...seeds],
              successCount: successfulIndexes.length,
              failedCount: batchPayloads.length - successfulIndexes.length,
              // 逐轮执行明细（1-based 轮号、该轮种子、失败状态与原因）。
              perRound: batchPayloads.map((payload, index) => ({
                round: index + 1,
                seed: payload.seed,
                failed: !successfulIndexSet.has(index),
                error: errors[index] ? String(errors[index]) : '',
              })),
              // 每玩家每指标统计：values / rounds（1-based 原始轮号）为成功轮逐轮序列，
              // 其余字段为 summarizeSeries 的 12 项稳健统计。
              perPlayer: playerStats,
              // 聚合行来源自证：results.summaryRows 由成功轮的 summarizeResult 行经
              // summarizeSeries 稳健融合（robustMean）得到，口径与队列多轮排名一致。
              aggregation: {
                metricSource: 'summarizeSeries.robustMean',
                summaryRowSource: 'perRoundSummaries',
                successRounds: successfulIndexes.length,
              },
            };
            this.syncActiveResultPlayerToActivePlayer(this.activePlayerId);
            this.runtime.completionNoticeId += 1;
          })
          .catch((error) => {
            if (isWorkerRunCancelledError(error)) {
              // 用户点「停止」：stopSimulation 已复位运行时状态；这里只保证失败路径不挂起。
              this.runtime.isRunning = false;
              return;
            }
            onError(error);
          });

        return;
      }

      if (runScope === RUN_SCOPE_ALL_LABYRINTHS) {
        const labyrinths = buildAllLabyrinthTargets(this.getActiveLabyrinthCrates(), this.getActiveLabyrinthUpgrades());
        if (labyrinths.length === 0) {
          this.runtime.isRunning = false;
          this.runtime.error = 'common:simulation.errorNoLabyrinthTargets';
          return;
        }

        workerClient.startMultiSimulation(
          {
            type: 'start_simulation_all_labyrinths',
            players: playersToSim,
            labyrinths,
            parallelWorkerLimit,
            simulationTimeLimit,
            extra,
          },
          {
            onProgress,
            onBatchResult: (simResults, batchResultType) => {
              this.runtime.progress = 1;
              this.runtime.isRunning = false;
              this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
              this.results.simResults = simResults;
              this.results.batchRows = summarizeBatchResults(simResults, selectedPlayersSnapshot, pricingOptions);
              this.results.batchResultType = batchResultType || 'simulation_result_allLabyrinths';
              this.runtime.completionNoticeId += 1;
            },
            onError,
          },
        );

        return;
      }

      const selectedZoneHrids =
        runScope === RUN_SCOPE_ALL_GROUP_ZONES
          ? this.simulationSettings.selectedGroupZoneHrids
          : this.simulationSettings.selectedSoloZoneHrids;
      const zones = buildZoneTargetsByScope(runScope, selectedZoneHrids);
      if (zones.length === 0) {
        this.runtime.isRunning = false;
        this.runtime.error = 'common:simulation.errorNoZoneTargets';
        return;
      }

      workerClient.startMultiSimulation(
        {
          type: 'start_simulation_all_zones',
          players: playersToSim,
          zones,
          parallelWorkerLimit,
          simulationTimeLimit,
          extra,
        },
        {
          onProgress,
          onBatchResult: (simResults, batchResultType) => {
            this.runtime.progress = 1;
            this.runtime.isRunning = false;
            this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
            this.results.simResults = simResults;
            this.results.batchRows = summarizeBatchResults(simResults, selectedPlayersSnapshot, pricingOptions);
            this.results.batchResultType = batchResultType || 'simulation_result_allZones';
            this.runtime.completionNoticeId += 1;
          },
          onError,
        },
      );
    },
  };
}
