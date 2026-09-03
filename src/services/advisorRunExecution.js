import {
  ADVISOR_GOAL_PRESET_BALANCED,
  ADVISOR_GOAL_PRESET_IRONCOW,
  normalizeAdvisorGoalPreset,
  normalizeAdvisorWeights,
  normalizeIroncowWeights,
} from './advisorScoring.js';
import {
  buildAdvisorCandidates,
  buildAdvisorPartialErrorText,
  buildAdvisorRowFromRoundMetrics,
  createAdvisorSimulationPayload,
  normalizeAdvisorFilters,
  resolveAdvisorMetricPlayer,
  summarizeAdvisorTargetResult,
} from './advisorDomain.js';
import { ONE_HOUR, buildSimulationExtra } from './simulationDomain.js';
import { normalizeParallelWorkerLimit } from './queueScoring.js';
import {
  DEDICATED_WORKER_SCOPE_ADVISOR,
  createWorkerRunCancellationError,
  isWorkerRunCancelledError,
  runMultiSimulationPayloadWithDedicatedWorker,
  runSingleSimulationPayloadWithDedicatedWorker,
} from './simulatorWorkerRuns.js';
import { createProfitPricingOptions } from './simulatorStorage.js';
import { clamp } from './utils.js';
import { runParallelWorkerPool } from './workerPool.js';

const ADVISOR_ERROR_ANOTHER_RUN = 'Another simulation is already running.';
const ADVISOR_ERROR_NO_PLAYERS = 'Please select at least one player.';
const ADVISOR_ERROR_NO_SIMULATION_PLAYERS = 'Unable to build player simulation data.';
const ADVISOR_ERROR_NO_TARGETS = 'No advisor targets available for the current filters.';
const ADVISOR_ERROR_NO_DROP_ITEMS = 'Please select at least one target drop item.';

function createAdvisorScanContext({
  store,
  selectedPlayersSnapshot,
  playersToSim,
  normalizedFilters,
  normalizedGoalPreset,
  normalizedCustomWeights,
  normalizedIroncowWeights,
  candidates,
  metricPlayer,
  pricingOptions,
  simulationTimeLimit,
  extra,
  refineTopCount,
  startedAt,
  runId,
}) {
  // 非铁牛模式不消费掉落数据（评分/顶卡/表格列/staleness 均不读 drops），
  // 随设置残留的物品选择不应触发每候选每轮的 buildNoRngDropCountMap 全
  // 掉落表遍历（主线程，且与 summarizeResult 内部已算过的同一 Map 重复）。
  // 门控口径与 buildAdvisorCandidates 的物品过滤及上方空物品校验一致：
  // 仅 goalPreset==='ironcow' 时把物品列表传入掉落速率计算。
  const scanDropItemHrids = normalizedGoalPreset === ADVISOR_GOAL_PRESET_IRONCOW ? normalizedFilters.dropItemHrids : [];
  let quickRoundsTotal = candidates.length * normalizedFilters.quickRounds;
  let refineTotal = refineTopCount * normalizedFilters.refineRounds;
  let totalWorkUnits = Math.max(1, quickRoundsTotal + refineTotal);
  let quickCompleted = 0;
  let refineCompleted = 0;
  const errorMessages = [];
  const quickRowsById = new Map();
  const quickSamplesById = new Map();
  const refinedRowsById = new Map();

  store.advisor.runtime.runId = runId;
  store.advisor.runtime.cancelRequested = false;

  const isCurrentAdvisorRun = () => Number(store.advisor.runtime?.runId || 0) === runId;
  const isActiveAdvisorRun = () => isCurrentAdvisorRun() && store.advisor.runtime?.cancelRequested !== true;
  const getAdvisorRowsForReturn = () =>
    Array.isArray(store.advisor.refinedRows) && store.advisor.refinedRows.length > 0
      ? store.advisor.refinedRows
      : store.advisor.quickRows;
  const ensureActiveAdvisorRun = () => {
    if (!isActiveAdvisorRun()) {
      throw createWorkerRunCancellationError('Advisor scan cancelled.');
    }
  };
  const updateAdvisorRuntime = (phase, quickInFlightUnits = 0, refineInFlightUnits = 0) => {
    if (!isActiveAdvisorRun()) {
      return;
    }

    store.advisor.runtime.isRunning = true;
    store.advisor.runtime.phase = phase;
    store.advisor.runtime.startedAt = startedAt;
    store.advisor.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
    store.advisor.runtime.quickCompleted = quickCompleted;
    store.advisor.runtime.quickTotal = quickRoundsTotal;
    store.advisor.runtime.refineCompleted = refineCompleted;
    store.advisor.runtime.refineTotal = refineTotal;
    store.advisor.runtime.runId = runId;
    store.advisor.runtime.cancelRequested = false;
    const completedWorkUnits = quickCompleted + quickInFlightUnits + refineCompleted + refineInFlightUnits;
    store.advisor.runtime.progress = clamp(completedWorkUnits / totalWorkUnits, 0, 1);
  };
  const rerankLiveQuickRows = () => {
    if (!isActiveAdvisorRun()) {
      return;
    }
    store.rerankAdvisorResults({
      goalPreset: normalizedGoalPreset,
      customWeights: normalizedCustomWeights,
      ironcowWeights: normalizedIroncowWeights,
      quickRows: Array.from(quickRowsById.values()),
      refinedRows: [],
      // 流式 rerank 高频触发（每个候选每轮一次），跳过落盘：设置已在扫描开始
      // 持久化，扫描期间设置不可变（2026-09-03 修复：避免约千次冗余同步写）。
      persist: false,
    });
  };
  const rerankLiveRefinedRows = () => {
    if (!isActiveAdvisorRun()) {
      return;
    }
    const mergedRows = store.advisor.quickRows.map((row) => refinedRowsById.get(row.id) || row);
    store.rerankAdvisorResults({
      goalPreset: normalizedGoalPreset,
      customWeights: normalizedCustomWeights,
      ironcowWeights: normalizedIroncowWeights,
      quickRows: store.advisor.quickRows,
      refinedRows: mergedRows,
      // 同 rerankLiveQuickRows：流式高频路径跳过落盘。
      persist: false,
    });
  };
  const storeQuickResult = (candidate, simResult, roundIndex) => {
    if (!candidate || !simResult) {
      return false;
    }

    const samples = quickSamplesById.get(candidate.id) || [];
    if (samples.length > roundIndex) {
      return false;
    }

    const sample = summarizeAdvisorTargetResult(
      simResult,
      selectedPlayersSnapshot,
      metricPlayer.id,
      pricingOptions,
      scanDropItemHrids,
    );
    samples.push(sample);
    quickSamplesById.set(candidate.id, samples);
    quickRowsById.set(
      candidate.id,
      buildAdvisorRowFromRoundMetrics(candidate, samples, {
        isRefined: false,
        refineRounds: 0,
      }),
    );
    quickCompleted += 1;
    updateAdvisorRuntime('quick_scan', 0, 0);
    rerankLiveQuickRows();
    return true;
  };
  const hasSampleForRound = (candidateId, roundIndex) => {
    const samples = quickSamplesById.get(candidateId);
    return Array.isArray(samples) && samples.length > roundIndex;
  };
  const collectQuickRows = async (batchCandidates, payloadBuilder, stageLabel, roundIndex) => {
    if (batchCandidates.length === 0) {
      return;
    }

    const baselineCompleted = quickCompleted;
    try {
      await runMultiSimulationPayloadWithDedicatedWorker(
        payloadBuilder(),
        (data) => {
          if (!isActiveAdvisorRun()) {
            return;
          }
          const completedWorkUnits = clamp(Number(data?.progress || 0), 0, 1) * batchCandidates.length;
          const inFlightWorkUnits = Math.max(0, completedWorkUnits - (quickCompleted - baselineCompleted));
          updateAdvisorRuntime('quick_scan', inFlightWorkUnits, 0);
        },
        {
          scope: DEDICATED_WORKER_SCOPE_ADVISOR,
          onItemResult: (data) => {
            ensureActiveAdvisorRun();
            const candidate = batchCandidates[Number(data?.index)];
            if (!candidate) {
              return;
            }
            storeQuickResult(candidate, data?.simResult, roundIndex);
          },
        },
      );
    } catch (batchError) {
      if (isWorkerRunCancelledError(batchError)) {
        throw batchError;
      }

      const failedCandidates = [];
      for (const candidate of batchCandidates) {
        if (hasSampleForRound(candidate.id, roundIndex)) {
          continue;
        }

        try {
          const simResult = await runSingleSimulationPayloadWithDedicatedWorker(
            createAdvisorSimulationPayload(candidate, playersToSim, simulationTimeLimit, extra),
            (data) => {
              if (!isActiveAdvisorRun()) {
                return;
              }
              updateAdvisorRuntime('quick_scan', clamp(Number(data?.progress || 0), 0, 1), 0);
            },
            { scope: DEDICATED_WORKER_SCOPE_ADVISOR },
          );
          ensureActiveAdvisorRun();
          storeQuickResult(candidate, simResult, roundIndex);
        } catch (error) {
          if (isWorkerRunCancelledError(error)) {
            throw error;
          }
          failedCandidates.push(candidate);
        } finally {
          if (!hasSampleForRound(candidate.id, roundIndex)) {
            quickCompleted += 1;
            updateAdvisorRuntime('quick_scan', 0, 0);
          }
        }
      }
      const partialError = buildAdvisorPartialErrorText(stageLabel, failedCandidates);
      if (partialError) {
        errorMessages.push(partialError);
      }
    }
  };

  return {
    selectedPlayersSnapshot,
    playersToSim,
    normalizedFilters,
    scanDropItemHrids,
    candidates,
    metricPlayer,
    pricingOptions,
    simulationTimeLimit,
    extra,
    refineTopCount,
    startedAt,
    runId,
    errorMessages,
    quickRowsById,
    refinedRowsById,
    isCurrentAdvisorRun,
    isActiveAdvisorRun,
    getAdvisorRowsForReturn,
    ensureActiveAdvisorRun,
    updateAdvisorRuntime,
    rerankLiveQuickRows,
    rerankLiveRefinedRows,
    collectQuickRows,
    get quickCompleted() {
      return quickCompleted;
    },
    get refineCompleted() {
      return refineCompleted;
    },
    get quickRoundsTotal() {
      return quickRoundsTotal;
    },
    get refineTotal() {
      return refineTotal;
    },
    set quickRoundsTotal(value) {
      quickRoundsTotal = value;
    },
    set refineTotal(value) {
      refineTotal = value;
    },
    set totalWorkUnits(value) {
      totalWorkUnits = value;
    },
    incrementRefineCompleted() {
      refineCompleted += 1;
    },
  };
}

async function runAdvisorQuickPhase(context) {
  context.updateAdvisorRuntime('quick_scan', 0, 0);
  for (let quickRoundIndex = 0; quickRoundIndex < context.normalizedFilters.quickRounds; quickRoundIndex += 1) {
    const roundCandidates =
      quickRoundIndex === 0
        ? context.candidates
        : context.candidates.filter((candidate) => context.quickRowsById.has(candidate.id));
    if (roundCandidates.length === 0) {
      break;
    }
    if (quickRoundIndex === 1 && roundCandidates.length < context.candidates.length) {
      const surviving = roundCandidates.length;
      context.quickRoundsTotal = context.candidates.length + surviving * (context.normalizedFilters.quickRounds - 1);
      context.totalWorkUnits = Math.max(1, context.quickRoundsTotal + context.refineTotal);
    }
    await context.collectQuickRows(
      roundCandidates,
      () => ({
        type: 'start_simulation_all_zones',
        players: context.playersToSim,
        zones: roundCandidates.map((candidate) => ({
          zoneHrid: candidate.targetHrid,
          difficultyTier: candidate.difficultyTier,
        })),
        simulationTimeLimit: context.simulationTimeLimit,
        extra: context.extra,
      }),
      'quick scan',
      quickRoundIndex,
    );
    context.ensureActiveAdvisorRun();
  }

  if (context.quickRowsById.size === 0) {
    throw new Error(context.errorMessages[0] || 'Advisor scan did not produce any successful result.');
  }
  context.ensureActiveAdvisorRun();
  context.rerankLiveQuickRows();
}

async function runAdvisorRefinePhase(context, store) {
  if (!context.normalizedFilters.refineTopEnabled || context.refineTopCount <= 0) {
    return;
  }

  const quickRowsForRefine = store.advisor.quickRows.slice(0, context.refineTopCount);
  context.quickRoundsTotal = context.quickCompleted;
  context.refineTotal = quickRowsForRefine.length * context.normalizedFilters.refineRounds;
  context.totalWorkUnits = Math.max(1, context.quickRoundsTotal + context.refineTotal);
  context.updateAdvisorRuntime('refine_top', 0, 0);
  const roundMetricsById = new Map(quickRowsForRefine.map((row) => [row.id, []]));
  const refineParallelWorkerLimit = Math.max(
    1,
    Math.min(
      normalizeParallelWorkerLimit(store.queueRuntime?.parallelWorkerLimit, store.queueParallelWorkerHardMax),
      quickRowsForRefine.length,
    ),
  );

  const runRefineRoundForRow = async (row) => {
    try {
      const simResult = await runSingleSimulationPayloadWithDedicatedWorker(
        createAdvisorSimulationPayload(row, context.playersToSim, context.simulationTimeLimit, context.extra),
        () => {},
        { scope: DEDICATED_WORKER_SCOPE_ADVISOR },
      );
      context.ensureActiveAdvisorRun();
      const roundMetrics = roundMetricsById.get(row.id) || [];
      roundMetrics.push(
        summarizeAdvisorTargetResult(
          simResult,
          context.selectedPlayersSnapshot,
          context.metricPlayer.id,
          context.pricingOptions,
          context.scanDropItemHrids,
        ),
      );
      roundMetricsById.set(row.id, roundMetrics);
      if (roundMetrics.length >= context.normalizedFilters.refineRounds) {
        context.refinedRowsById.set(
          row.id,
          buildAdvisorRowFromRoundMetrics(row, roundMetrics, {
            isRefined: true,
            refineRounds: context.normalizedFilters.refineRounds,
          }),
        );
        context.rerankLiveRefinedRows();
      }
    } catch (error) {
      if (isWorkerRunCancelledError(error)) {
        throw error;
      }
    } finally {
      context.incrementRefineCompleted();
      context.updateAdvisorRuntime('refine_top', 0, 0);
    }
  };

  for (let roundIndex = 0; roundIndex < context.normalizedFilters.refineRounds; roundIndex += 1) {
    if (refineParallelWorkerLimit > 1 && quickRowsForRefine.length > 1) {
      await runParallelWorkerPool({
        taskCount: quickRowsForRefine.length,
        workerLimit: refineParallelWorkerLimit,
        runTask: (rowIndex) => runRefineRoundForRow(quickRowsForRefine[rowIndex]),
      });
      continue;
    }

    for (const row of quickRowsForRefine) {
      await runRefineRoundForRow(row);
    }
  }

  const refinedFailures = quickRowsForRefine.filter((row) => !context.refinedRowsById.has(row.id));
  const refinePartialError = buildAdvisorPartialErrorText('refine step', refinedFailures);
  if (refinePartialError) {
    context.errorMessages.push(refinePartialError);
  }
  context.ensureActiveAdvisorRun();
  context.rerankLiveRefinedRows();
}

function completeAdvisorScan(context, store) {
  context.ensureActiveAdvisorRun();
  store.advisor.error = context.errorMessages.join(' ').trim();
  store.advisor.runtime.isRunning = false;
  store.advisor.runtime.phase = 'done';
  store.advisor.runtime.progress = 1;
  store.advisor.runtime.elapsedSeconds = (Date.now() - context.startedAt) / 1000;
  store.advisor.runtime.lastRunAt = Date.now();
  store.advisor.runtime.cancelRequested = false;
  store.advisor.runtime.quickCompleted = context.quickCompleted;
  store.advisor.runtime.quickTotal = context.quickRoundsTotal;
  store.advisor.runtime.refineCompleted = context.refineCompleted;
  store.advisor.runtime.refineTotal = context.refineTotal;
  return context.getAdvisorRowsForReturn();
}

function handleAdvisorScanError(error, context, store) {
  if (!context.isCurrentAdvisorRun()) {
    return [];
  }
  if (isWorkerRunCancelledError(error) || store.advisor.runtime?.cancelRequested === true) {
    store.advisor.error = '';
    store.advisor.runtime.isRunning = false;
    store.advisor.runtime.phase = 'cancelled';
    store.advisor.runtime.elapsedSeconds = (Date.now() - context.startedAt) / 1000;
    store.advisor.runtime.quickCompleted = context.quickCompleted;
    store.advisor.runtime.quickTotal = context.quickRoundsTotal;
    store.advisor.runtime.refineCompleted = context.refineCompleted;
    store.advisor.runtime.refineTotal = context.refineTotal;
    return context.getAdvisorRowsForReturn();
  }

  store.advisor.error = typeof error === 'string' ? error : error?.message || JSON.stringify(error);
  store.advisor.runtime.isRunning = false;
  store.advisor.runtime.phase = 'idle';
  store.advisor.runtime.progress = 0;
  store.advisor.runtime.elapsedSeconds = (Date.now() - context.startedAt) / 1000;
  store.advisor.runtime.cancelRequested = false;
  return [];
}

// 入口段失败兜底（context 创建之前：loadPlayerMapperModule 动态导入、
// buildPlayersForSimulation、同步准备）。契约与 handleAdvisorScanError 一致：
// 绝不向上抛出，写 store.advisor.error 并返回 []——让 runAdvisorScan 正常走完
// 收尾落盘、页内错误条接管反馈；此前该段异常逃逸成 void runAdvisor() 的全局
// unhandledrejection 弹窗并跳过收尾落盘。此阶段本次扫描尚未触碰 runtime
// （isRunning 恒为 false、runId/startedAt 未写入），复位仅作防御；现实失败点
// （导入/玩家构建）位于「清空旧结果」之前，失败尝试保留旧结果。
function handleAdvisorScanEntryError(error, store) {
  store.advisor.error = typeof error === 'string' ? error : error?.message || JSON.stringify(error);
  store.advisor.runtime.isRunning = false;
  store.advisor.runtime.phase = 'idle';
  store.advisor.runtime.progress = 0;
  store.advisor.runtime.cancelRequested = false;
  return [];
}

export async function executeAdvisorScan({ store, loadPlayerMapperModule }) {
  store.advisor.error = '';
  if (store.runtime.isRunning || store.isAnyQueueRunning || store.advisor.runtime?.isRunning) {
    store.advisor.error = ADVISOR_ERROR_ANOTHER_RUN;
    return [];
  }

  const selectedPlayersSnapshot = store.selectedPlayers.map((player) => ({ id: player.id, name: player.name }));
  if (selectedPlayersSnapshot.length === 0) {
    store.advisor.error = ADVISOR_ERROR_NO_PLAYERS;
    return [];
  }

  // 铁牛模式未选目标物品时阻止扫描（掉落维度无数据来源）。该条件只依赖
  // goalPreset 与 filters.dropItemHrids（同步可判，与下方动态导入无关），
  // 提前到首个 await 之前：①即时报错，首扫不必等待 loadPlayerMapperModule
  // 的导入窗口；②不会触达下方「清空结果」逻辑，已有扫描结果（如从
  // balanced 切到铁牛但尚未选物品）不被一次失败的尝试静默清空。入口为
  // balanced、导入窗口内才切到铁牛的穿透场景此处覆盖不到，由 await 之后
  // 的同款校验兜底（见下），构成双门。
  const earlyGoalPreset = normalizeAdvisorGoalPreset(store.advisor.goalPreset);
  const earlyDropItemHrids = normalizeAdvisorFilters(store.advisor.filters).dropItemHrids;
  if (earlyGoalPreset === ADVISOR_GOAL_PRESET_IRONCOW && earlyDropItemHrids.length === 0) {
    store.advisor.error = ADVISOR_ERROR_NO_DROP_ITEMS;
    return [];
  }

  // 入口段（动态导入 → 玩家构建 → 同步准备 → context 创建）与 quick/refine 阶段
  // 共用同一个错误契约：任何失败都不向上抛出，统一转入 store.advisor.error（页内
  // 错误条）并正常返回 []。此前入口段在 try 保护之外——弱网下动态导入 reject
  // （重新部署后旧 chunk 404 亦然）或 buildPlayersForSimulation 抛错会逃逸成
  // runAdvisor() 的全局 unhandledrejection 弹窗，且跳过 runAdvisorScan 的收尾
  // 落盘。context 尚未创建的失败由 handleAdvisorScanEntryError 兜底（runId/
  // startedAt 尚未写入，handleAdvisorScanError 不可用）。
  let context = null;
  try {
    const { buildPlayersForSimulation } = await loadPlayerMapperModule();
    const playersToSim = buildPlayersForSimulation(store.players);
    if (playersToSim.length === 0) {
      store.advisor.error = ADVISOR_ERROR_NO_SIMULATION_PLAYERS;
      return [];
    }

    const normalizedFilters = normalizeAdvisorFilters(store.advisor.filters);
    const normalizedGoalPreset = normalizeAdvisorGoalPreset(store.advisor.goalPreset);
    const normalizedCustomWeights = normalizeAdvisorWeights(store.advisor.customWeights, ADVISOR_GOAL_PRESET_BALANCED);
    const normalizedIroncowWeights = normalizeIroncowWeights(store.advisor.ironcowWeights);
    const candidates = buildAdvisorCandidates(normalizedFilters, normalizedGoalPreset);
    const metricPlayer = resolveAdvisorMetricPlayer(selectedPlayersSnapshot, store.activePlayerId);

    // 全部校验先于 store 变异：下方的写回/清空一旦执行，上一轮结果即不可
    // 恢复，校验若放在其后（旧顺序），任何失败都会造成「旧结果丢失 + 无新
    // 结果」。铁牛空物品校验同时是入口早校验的权威终门——入口为 balanced、
    // 动态导入窗口内才切预设到铁牛（setPreset 仅拦 isRunning，窗口期尚未
    // 置位）的穿透场景只有此处能拦，且现在同样不会先清空结果。
    if (candidates.length === 0) {
      store.advisor.error = ADVISOR_ERROR_NO_TARGETS;
      return [];
    }

    // 铁牛模式未选目标物品时阻止扫描（掉落维度无数据来源）。
    if (normalizedGoalPreset === ADVISOR_GOAL_PRESET_IRONCOW && normalizedFilters.dropItemHrids.length === 0) {
      store.advisor.error = ADVISOR_ERROR_NO_DROP_ITEMS;
      return [];
    }

    // 全部校验通过、扫描正式开始：写回归一化设置、清空上一轮结果，并记录
    // 本次扫描的模式与目标物品快照，供 rerankAdvisorResults 做「扫描参数已
    // 变」的 staleness 检测。
    store.advisor.filters = normalizedFilters;
    store.advisor.goalPreset = normalizedGoalPreset;
    store.advisor.customWeights = normalizedCustomWeights;
    store.advisor.quickRows = [];
    store.advisor.refinedRows = [];
    store.advisor.topCards = [];
    store.advisor.metricPlayerId = metricPlayer.id;
    store.advisor.metricPlayerName = metricPlayer.name;
    store.advisor.scannedGoalPreset = normalizedGoalPreset;
    store.advisor.scannedDropItemHrids = [...normalizedFilters.dropItemHrids];

    const simulationTimeHours = Math.max(1, Number(store.simulationSettings.simulationTimeHours || 24));
    const simulationTimeLimit = simulationTimeHours * ONE_HOUR;
    const extra = {
      ...buildSimulationExtra(store.simulationSettings),
      enableHpMpVisualization: false,
    };
    const pricingOptions = createProfitPricingOptions(store.pricing);
    const refineTopCount = normalizedFilters.refineTopEnabled
      ? Math.min(normalizedFilters.refineTopCount, candidates.length)
      : 0;
    const startedAt = Date.now();
    const runId = Number(store.advisor.runtime?.runId || 0) + 1;
    context = createAdvisorScanContext({
      store,
      selectedPlayersSnapshot,
      playersToSim,
      normalizedFilters,
      normalizedGoalPreset,
      normalizedCustomWeights,
      normalizedIroncowWeights,
      candidates,
      metricPlayer,
      pricingOptions,
      simulationTimeLimit,
      extra,
      refineTopCount,
      startedAt,
      runId,
    });

    await runAdvisorQuickPhase(context);
    await runAdvisorRefinePhase(context, store);
    return completeAdvisorScan(context, store);
  } catch (error) {
    if (!context) {
      return handleAdvisorScanEntryError(error, store);
    }
    return handleAdvisorScanError(error, context, store);
  }
}
