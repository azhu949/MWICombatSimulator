import { RUN_SCOPE_SINGLE, computeQueueMetrics, summarizeResult } from './simulationDomain.js';
import {
  buildQueueRankedRowsFromSampleState,
  hasAggregatedQueueBaselineMetrics,
  normalizeBaselineSaleSide,
  normalizeParallelWorkerLimit,
  normalizeQueueSettings,
  resolveQueueBaselineMetricsForSettings,
} from './queueScoring.js';
import {
  buildQueueCostWarnings,
  computeQueueItemUpgradeCost,
  createMissingEquipmentAskError,
  inspectQueueEquipmentPricing,
  mergeConfirmedPricesAndSelections,
} from './queueUpgradeCost.js';
import { createProfitPricingOptions } from './simulatorStorage.js';
import {
  createWorkerRunCancellationError,
  isWorkerRunCancelledError,
  stopQueueWorkerClients,
} from './simulatorWorkerRuns.js';
import { clamp, deepClone, isPlainObject } from './utils.js';
import { runParallelWorkerPool } from './workerPool.js';

const REALTIME_RANKING_THROTTLE_MS = 250;

function formatQueueErrorMessage(error, fallback = 'Simulation failed.') {
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

function formatPartialRunMessage(label, successfulCount, totalCount, failures = []) {
  const failureCount = Array.isArray(failures) ? failures.length : 0;
  const firstFailure = failures.find((failure) => failure?.message)?.message || 'Unknown error.';
  return `${label} partially completed: ${successfulCount}/${totalCount} run(s) succeeded, ${failureCount} failed. First failure: ${firstFailure}`;
}

function createQueueRunContext({
  store,
  queueState,
  queueSettings,
  executionMode,
  queuePayloadOptions,
  activePlayerId,
  selectedPlayersSnapshot,
  pricingOptions,
  queueRunId,
  startedAt,
  baselineMetrics,
  entries,
  loadPlayerMapperModule,
  buildQueuePartySelectedPlayers,
  computeQueueMetricDeltas,
  syncQueueRawRunDeltas,
}) {
  const roundCount = queueSettings.rounds;
  const totalRuns = entries.length * roundCount;
  const runProgressByRunKey = new Map();
  const runFailures = [];
  const queueParallelWorkerLimit =
    executionMode === 'parallel'
      ? Math.max(
          1,
          Math.min(
            normalizeParallelWorkerLimit(store.queueRuntime?.parallelWorkerLimit, store.queueParallelWorkerHardMax),
            entries.length,
          ),
        )
      : 1;
  let settledRuns = 0;
  let lastRealtimeRankingAt = 0;

  const isCurrentQueueRun = () => Number(queueState.runId || 0) === queueRunId;
  const isActiveQueueRun = () => isCurrentQueueRun() && queueState.cancelRequested !== true;
  const ensureCurrentQueueRun = () => {
    if (!isCurrentQueueRun()) {
      throw createWorkerRunCancellationError('Queue run cancelled.');
    }
  };
  const ensureQueueRunNotCancelled = () => {
    if (!isActiveQueueRun()) {
      throw createWorkerRunCancellationError('Queue run cancelled.');
    }
  };
  const updateQueueRunProgress = () => {
    if (!isCurrentQueueRun()) {
      return;
    }
    const inProgress = Array.from(runProgressByRunKey.values()).reduce(
      (sum, value) => sum + clamp(Number(value || 0), 0, 1),
      0,
    );
    const overall = (settledRuns + inProgress) / totalRuns;
    queueState.progress = clamp(overall, 0, 1);
    store.runtime.progress = queueState.progress;
    store.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
  };
  const updateRealtimeRanking = (force = false) => {
    if (!isCurrentQueueRun()) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastRealtimeRankingAt < REALTIME_RANKING_THROTTLE_MS) {
      return;
    }

    const currentQueueSettings = normalizeQueueSettings(queueState.settings);
    queueState.settings = currentQueueSettings;
    const currentBaselineMetrics = resolveQueueBaselineMetricsForSettings(queueState?.baseline, currentQueueSettings);
    if (queueState?.baseline && isPlainObject(currentBaselineMetrics)) {
      queueState.baseline.metrics = {
        ...(isPlainObject(queueState.baseline.metrics) ? queueState.baseline.metrics : {}),
        ...currentBaselineMetrics,
      };
    }
    syncQueueRawRunDeltas(queueState.rawRuns, isPlainObject(currentBaselineMetrics) ? currentBaselineMetrics : {});
    const realtimeRows = buildQueueRankedRowsFromSampleState({
      entries,
      rawRuns: queueState.rawRuns,
      queueSettings: currentQueueSettings,
      queueState,
      baselineMetrics: isPlainObject(currentBaselineMetrics) ? currentBaselineMetrics : {},
      pricingState: store.pricing,
      queueRuntimeSettings: store.queueRuntime,
      includeEmptyEntries: false,
      costDependencies: {
        inspectQueueEquipmentPricing,
        computeQueueItemUpgradeCost,
      },
    });
    if (realtimeRows.length <= 0) {
      return;
    }
    queueState.results = realtimeRows;
    queueState.ranking = realtimeRows;
    lastRealtimeRankingAt = now;
  };
  const buildScenarioPlayers = (entrySnapshot) => {
    const basePartyPlayers =
      Array.isArray(queueState?.baseline?.partySnapshot?.selectedPlayers) &&
      queueState.baseline.partySnapshot.selectedPlayers.length > 0
        ? queueState.baseline.partySnapshot.selectedPlayers
        : buildQueuePartySelectedPlayers(store.players, activePlayerId);
    const scenarioPlayers = basePartyPlayers.map((player) => ({
      ...deepClone(player),
      selected: true,
    }));
    const activeIndex = scenarioPlayers.findIndex((player) => String(player.id) === activePlayerId);
    if (activeIndex === -1) {
      throw new Error('Unable to locate active player for queue run.');
    }

    scenarioPlayers[activeIndex] = {
      ...deepClone(entrySnapshot),
      id: activePlayerId,
      selected: true,
      name: entrySnapshot?.name || selectedPlayersSnapshot[0].name,
    };
    return scenarioPlayers;
  };
  const runEntryRound = async (entry, roundIndex) => {
    ensureQueueRunNotCancelled();
    const runKey = `${entry.id}-${roundIndex + 1}`;
    runProgressByRunKey.set(runKey, 0);
    updateQueueRunProgress();
    let runSettled = false;

    try {
      const { buildPlayersForSimulation } = await loadPlayerMapperModule();
      const playersToSim = buildPlayersForSimulation(buildScenarioPlayers(entry.snapshot));
      const payload = store.buildSingleSimulationPayload(playersToSim, queuePayloadOptions);
      const runSingle =
        executionMode === 'parallel'
          ? store.runSingleSimulationPayloadWithDedicatedWorker
          : store.runSingleSimulationPayload;
      const simResult = await runSingle.call(store, payload, (data) => {
        if (!isActiveQueueRun()) {
          return;
        }
        runProgressByRunKey.set(runKey, clamp(Number(data.progress || 0), 0, 1));
        updateQueueRunProgress();
      });

      ensureCurrentQueueRun();
      const summary = summarizeResult(simResult, selectedPlayersSnapshot, pricingOptions)[0] || {};
      const metrics = computeQueueMetrics(simResult, activePlayerId, pricingOptions);
      const deltas = computeQueueMetricDeltas(metrics, baselineMetrics);
      queueState.rawRuns.push({
        id: entry.id,
        label: entry.label,
        changes: Array.isArray(entry.changes) ? [...entry.changes] : [],
        changeDetails: Array.isArray(entry.changeDetails) ? deepClone(entry.changeDetails) : [],
        round: roundIndex + 1,
        metrics,
        deltas,
        ...summary,
      });
      runSettled = true;
      updateRealtimeRanking(false);
    } catch (error) {
      if (isWorkerRunCancelledError(error)) {
        throw error;
      }
      runFailures.push({
        id: entry.id,
        label: entry.label,
        round: roundIndex + 1,
        message: formatQueueErrorMessage(error),
      });
      runSettled = true;
    } finally {
      runProgressByRunKey.delete(runKey);
      if (runSettled) {
        settledRuns += 1;
      }
      updateQueueRunProgress();
    }
  };

  return {
    roundCount,
    totalRuns,
    runFailures,
    isCurrentQueueRun,
    ensureQueueRunNotCancelled,
    runEntryRound,
    queueParallelWorkerLimit,
  };
}

async function runQueueRounds(context, executionMode, entries) {
  for (let roundIndex = 0; roundIndex < context.roundCount; roundIndex += 1) {
    context.ensureQueueRunNotCancelled();
    if (executionMode === 'parallel' && entries.length > 1) {
      await runParallelWorkerPool({
        taskCount: entries.length,
        workerLimit: context.queueParallelWorkerLimit,
        ensureActive: () => context.ensureQueueRunNotCancelled(),
        runTask: (entryIndex) => context.runEntryRound(entries[entryIndex], roundIndex),
      });
      continue;
    }

    for (const entry of entries) {
      context.ensureQueueRunNotCancelled();
      // eslint-disable-next-line no-await-in-loop
      await context.runEntryRound(entry, roundIndex);
    }
  }
}

export async function executeActiveQueueRun({
  store,
  loadPlayerMapperModule,
  workerClient,
  buildQueuePartySelectedPlayers,
  buildQueueBaselinePayloadOptions,
  buildQueueEntriesFromState,
  computeQueueMetricDeltas,
  syncQueueRawRunDeltas,
}) {
  const queueState = store.ensureQueueState(store.activePlayerId);
  queueState.error = '';

  if (store.runtime.isRunning || store.isAnyQueueRunning || store.advisor.runtime?.isRunning) {
    queueState.error = 'common:queue.errorBusy';
    return [];
  }
  if (store.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
    queueState.error = 'common:queue.errorRunScopeSingle';
    return [];
  }
  if (!queueState.baseline?.snapshot) {
    queueState.error = 'common:queue.errorSetBaselineFirst';
    return [];
  }
  if (store.activeQueuePartyStatus?.hasMismatch) {
    queueState.error = store.activeQueuePartyStatus.messageKey || 'common:queue.partyChangedSinceBaseline';
    return [];
  }
  if (queueState.items.length === 0) {
    queueState.error = 'common:queue.errorQueueEmpty';
    return [];
  }

  const queueSettings = normalizeQueueSettings(queueState.settings);
  queueState.settings = queueSettings;
  const saleSide = normalizeBaselineSaleSide(queueSettings.baselineSaleSide);

  for (const item of queueState.items) {
    const confirmedEquipmentPrices = mergeConfirmedPricesAndSelections(item);
    const inspections = inspectQueueEquipmentPricing(
      queueState.baseline.snapshot,
      item?.snapshot,
      store.pricing,
      confirmedEquipmentPrices,
      { saleSide },
    );
    const invalid = inspections.find((inspection) => !inspection.targetAskAvailable);
    if (invalid) {
      queueState.error = 'common:queue.missingEnhancementAskQueued';
      throw createMissingEquipmentAskError(invalid, { queued: true });
    }
    item.costWarnings = buildQueueCostWarnings(inspections);
  }

  const executionMode = queueSettings.executionMode === 'parallel' ? 'parallel' : 'serial';
  const queuePayloadOptions = buildQueueBaselinePayloadOptions(queueState.baseline?.settings, store.simulationSettings);
  const activePlayerId = String(store.activePlayerId);
  const basePlayer = store.players.find((player) => String(player.id) === activePlayerId) ?? store.activePlayer;
  const selectedPlayersSnapshot = [{ id: activePlayerId, name: basePlayer?.name || `Player ${activePlayerId}` }];
  const pricingOptions = createProfitPricingOptions(store.pricing);
  const queueRunId = Number(queueState.runId || 0) + 1;
  const startedAt = Date.now();
  const aggregatedBaselineMetrics = resolveQueueBaselineMetricsForSettings(queueState?.baseline, queueSettings);
  const recomputedBaselineMetrics =
    !isPlainObject(aggregatedBaselineMetrics) &&
    !hasAggregatedQueueBaselineMetrics(queueState?.baseline) &&
    queueState?.baseline?.simResult
      ? computeQueueMetrics(queueState.baseline.simResult, activePlayerId, pricingOptions)
      : null;
  if (queueState?.baseline && (isPlainObject(aggregatedBaselineMetrics) || isPlainObject(recomputedBaselineMetrics))) {
    queueState.baseline.metrics = {
      ...(isPlainObject(queueState.baseline.metrics) ? queueState.baseline.metrics : {}),
      ...(isPlainObject(aggregatedBaselineMetrics) ? aggregatedBaselineMetrics : {}),
      ...(isPlainObject(recomputedBaselineMetrics) ? recomputedBaselineMetrics : {}),
    };
  }
  const baselineMetrics = isPlainObject(queueState?.baseline?.metrics) ? queueState.baseline.metrics : {};
  const entries = buildQueueEntriesFromState(queueState);

  queueState.isRunning = true;
  queueState.runId = queueRunId;
  queueState.cancelRequested = false;
  queueState.progress = 0;
  queueState.results = [];
  queueState.rawRuns = [];
  queueState.ranking = [];
  queueState.lastRunStatus = 'running';
  store.runtime.isRunning = true;
  store.runtime.progress = 0;
  store.runtime.error = '';
  store.runtime.startedAt = startedAt;
  store.runtime.elapsedSeconds = 0;
  store.runtime.workerMode = 'single';

  const context = createQueueRunContext({
    store,
    queueState,
    queueSettings,
    executionMode,
    queuePayloadOptions,
    activePlayerId,
    selectedPlayersSnapshot,
    pricingOptions,
    queueRunId,
    startedAt,
    baselineMetrics,
    entries,
    loadPlayerMapperModule,
    buildQueuePartySelectedPlayers,
    computeQueueMetricDeltas,
    syncQueueRawRunDeltas,
  });

  try {
    await runQueueRounds(context, executionMode, entries);
    context.ensureQueueRunNotCancelled();
    if (context.runFailures.length > 0 && queueState.rawRuns.length <= 0) {
      queueState.results = [];
      queueState.ranking = [];
      queueState.lastRunStatus = 'failed';
      queueState.error = context.runFailures[0]?.message || 'common:queue.errorQueueRunFailed';
      return [];
    }

    const rankedRows = await store.refreshQueueResultsFromRawRuns({
      playerId: activePlayerId,
      includeEmptyEntries: context.runFailures.length <= 0,
      allowReferenceLoad: true,
      sortRawRuns: true,
      updateLastRunAt: true,
    });
    if (context.runFailures.length > 0) {
      queueState.lastRunStatus = 'partial';
      queueState.error = formatPartialRunMessage(
        'Queue run',
        queueState.rawRuns.length,
        context.totalRuns,
        context.runFailures,
      );
    } else {
      queueState.lastRunStatus = 'completed';
      queueState.error = '';
    }
    return rankedRows;
  } catch (error) {
    if (isWorkerRunCancelledError(error)) {
      queueState.error = '';
      store.runtime.error = '';
      queueState.lastRunStatus = 'cancelled';
      if (queueState.rawRuns.length > 0) {
        try {
          return await store.refreshQueueResultsFromRawRuns({
            playerId: activePlayerId,
            includeEmptyEntries: false,
            allowReferenceLoad: false,
            sortRawRuns: true,
            updateLastRunAt: false,
          });
        } catch (refreshError) {
          // 当取消后的刷新失败时，保留已存储的最佳部分排名。
        }
      }
      return Array.isArray(queueState.ranking) ? queueState.ranking : [];
    }
    queueState.lastRunStatus = 'failed';
    queueState.error = formatQueueErrorMessage(error);
    return [];
  } finally {
    if (context.isCurrentQueueRun()) {
      queueState.isRunning = false;
      queueState.cancelRequested = false;
    }
    store.runtime.isRunning = false;
    store.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
    workerClient.stopSimulation();
    stopQueueWorkerClients();
  }
}
