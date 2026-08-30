import marketHistoryService from '../services/marketHistoryService.js';
import {
  createProfitPricingOptions,
  loadQueueRunSettingsByPlayerFromStorage,
  persistQueueRunSettingsByPlayerToStorage,
} from '../services/simulatorStorage.js';
import {
  createWorkerRunCancellationError,
  isWorkerRunCancelledError,
  stopQueueWorkerClients,
} from '../services/simulatorWorkerRuns.js';
import {
  RUN_SCOPE_SINGLE,
  buildQueueBaselineSettings,
  computeQueueMetrics,
  summarizeQueueBaselineMetrics,
  summarizeResult,
} from '../services/simulationDomain.js';
import {
  MANUAL_EQUIPMENT_PRICE_SOURCE,
  buildQueueBaselineAggregate,
  buildQueueRankedRowsFromSampleState,
  getDefaultQueueRunSettings,
  haveQueueRunRankingSettingsChanged,
  normalizeBaselineSaleSide,
  normalizeParallelWorkerLimit,
  normalizeQueueSettings,
  resolveQueueBaselineMetricsForSettings,
} from '../services/queueScoring.js';
import {
  buildQueueVariantSnapshotsFromChanges,
  computeQueueChangeSummary,
  deriveQueueVariantNameFromLabels,
} from '../services/queueVariants.js';
import { buildChangedEquipmentKeys, buildSelectionKey } from '../services/queuePriceSelection.js';
import { executeActiveQueueRun } from '../services/queueRunExecution.js';
import { runParallelWorkerPool } from '../services/workerPool.js';
import {
  buildQueueCostWarnings,
  computeMirrorPlan,
  computeQueueItemUpgradeCost,
  createEquipmentPriceConfirmationError,
  createInvalidManualEquipmentPriceError,
  createMissingEquipmentAskError,
  findInvalidManualEquipmentPriceEntry,
  findInvalidPriceSelection,
  getConfirmedEquipmentPriceKey,
  hasAbilityUpgradeReferenceDataLoaded,
  inspectQueueEquipmentPricing,
  mergeConfirmedPricesAndSelections,
  normalizeConfirmedEquipmentPrices,
  normalizeQueuePriceSelections,
  PHILOSOPHERS_MIRROR_ITEM_HRID,
  QUEUE_PRICE_METHOD_MANUAL,
  QUEUE_PRICE_METHOD_MIRROR,
  resolveBaselineSaleQuote,
  resolveReferenceEquipmentPrice,
  resolveRecentTradeAverage,
} from '../services/queueUpgradeCost.js';
import { clamp, deepClone, isPlainObject, toFiniteNumber } from '../services/utils.js';

export const QUEUE_PLAYER_IDS = ['1', '2', '3', '4', '5'];

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

export function createQueuePlayerState(queueSettings = getDefaultQueueRunSettings()) {
  return {
    baseline: null,
    items: [],
    results: [],
    rawRuns: [],
    ranking: [],
    abilityUpgradeCosts: {},
    settings: normalizeQueueSettings(queueSettings),
    isRunning: false,
    progress: 0,
    error: '',
    lastRunAt: 0,
    lastRunStatus: 'idle',
    runId: 0,
    cancelRequested: false,
  };
}

function buildQueuePartySelectedPlayers(players = [], activePlayerId = '1') {
  const normalizedActivePlayerId = String(activePlayerId || '1');
  const safePlayers = Array.isArray(players) ? players : [];
  const selectedPlayers = [];
  let activeIncluded = false;

  for (const player of safePlayers) {
    if (!player) {
      continue;
    }

    const clonedPlayer = deepClone(player);
    const isActivePlayer = String(clonedPlayer.id || '') === normalizedActivePlayerId;
    if (!isActivePlayer && clonedPlayer.selected !== true) {
      continue;
    }

    clonedPlayer.selected = true;
    selectedPlayers.push(clonedPlayer);
    activeIncluded = activeIncluded || isActivePlayer;
  }

  if (!activeIncluded) {
    const activePlayer = safePlayers.find((player) => String(player?.id || '') === normalizedActivePlayerId);
    if (activePlayer) {
      const clonedPlayer = deepClone(activePlayer);
      clonedPlayer.selected = true;
      selectedPlayers.unshift(clonedPlayer);
    }
  }

  return selectedPlayers;
}

export function buildQueuePartyComparisonPlayers(players = [], activePlayerId = '1') {
  const normalizedActivePlayerId = String(activePlayerId || '1');
  return buildQueuePartySelectedPlayers(players, activePlayerId)
    .filter((player) => String(player?.id || '') !== normalizedActivePlayerId)
    .map((player) => ({
      ...deepClone(player),
      selected: true,
    }))
    .sort((left, right) => String(left?.id || '').localeCompare(String(right?.id || '')));
}

export function buildQueuePartySignature(players = [], activePlayerId = '1') {
  return JSON.stringify(buildQueuePartyComparisonPlayers(players, activePlayerId));
}

function createQueuePartySnapshot(players = [], activePlayerId = '1') {
  const selectedPlayers = buildQueuePartySelectedPlayers(players, activePlayerId);
  return {
    selectedPlayers,
    signature: buildQueuePartySignature(selectedPlayers, activePlayerId),
    createdAt: Date.now(),
  };
}

export function createQueueStateByPlayer(playerList, settingsByPlayer = {}) {
  const stateByPlayer = {};
  for (const player of playerList) {
    const playerId = String(player.id);
    stateByPlayer[playerId] = createQueuePlayerState(settingsByPlayer?.[playerId]);
  }
  return stateByPlayer;
}

export function createImportedProfileByPlayer() {
  const importedByPlayer = {};
  for (const playerId of QUEUE_PLAYER_IDS) {
    importedByPlayer[playerId] = false;
  }
  return importedByPlayer;
}

export function createImportedBaselineByPlayer() {
  const baselineByPlayer = {};
  for (const playerId of QUEUE_PLAYER_IDS) {
    baselineByPlayer[playerId] = null;
  }
  return baselineByPlayer;
}

export function createQueueBaselineRecord(snapshot, partySnapshot, settings, overrides = {}) {
  return {
    snapshot: deepClone(snapshot),
    partySnapshot: partySnapshot ? deepClone(partySnapshot) : null,
    settings: deepClone(settings),
    metrics: null,
    simResult: null,
    completedRounds: 0,
    metricSummary: null,
    sampleMetadata: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function computeQueueMetricDeltas(metrics = {}, baselineMetrics = {}) {
  const deltas = {};
  const metricKeys = Object.keys(metrics);
  for (const key of metricKeys) {
    const baselineValue = toFiniteNumber(baselineMetrics?.[key], 0);
    const currentValue = toFiniteNumber(metrics?.[key], 0);
    const deltaAbs = currentValue - baselineValue;
    const deltaPct = Math.abs(baselineValue) <= 1e-9 ? null : (deltaAbs / baselineValue) * 100;
    deltas[key] = {
      abs: toFiniteNumber(deltaAbs, 0),
      pct: Number.isFinite(deltaPct) ? deltaPct : null,
    };
  }
  return deltas;
}

function syncQueueRawRunDeltas(rawRuns = [], baselineMetrics = {}) {
  if (!Array.isArray(rawRuns)) {
    return rawRuns;
  }

  for (const rawRun of rawRuns) {
    if (!isPlainObject(rawRun)) {
      continue;
    }
    rawRun.deltas = computeQueueMetricDeltas(rawRun.metrics, baselineMetrics);
  }

  return rawRuns;
}

function buildQueueEntriesFromState(queueState) {
  const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
  if (!baselineSnapshot) {
    return [];
  }

  return (Array.isArray(queueState?.items) ? queueState.items : [])
    .map((item, index) => {
      const summary = computeQueueChangeSummary(baselineSnapshot, item?.snapshot);
      const fallbackLabels = Array.isArray(summary?.labels) ? summary.labels : [];
      const fallbackChangeDetails = Array.isArray(summary?.changes) ? summary.changes : [];
      const changes = Array.isArray(item?.changes) && item.changes.length > 0 ? item.changes : fallbackLabels;
      const changeDetails =
        Array.isArray(item?.changeDetails) && item.changeDetails.length > 0
          ? deepClone(item.changeDetails)
          : deepClone(fallbackChangeDetails);
      const itemName = String(item?.name || '').trim();
      const label = itemName || deriveQueueVariantNameFromLabels(changes, index + 1);

      return {
        id: item?.id,
        label,
        snapshot: deepClone(item?.snapshot),
        changes,
        changeDetails,
        confirmedEquipmentPrices: normalizeConfirmedEquipmentPrices(item?.confirmedEquipmentPrices),
        priceSelections: normalizeQueuePriceSelections(item?.priceSelections),
      };
    })
    .filter((entry) => Boolean(entry.id));
}

function buildQueueBaselinePayloadOptions(baselineSettings = {}, fallbackSimulationSettings = {}) {
  const snapshot = isPlainObject(baselineSettings) ? baselineSettings : {};
  const fallback = isPlainObject(fallbackSimulationSettings) ? fallbackSimulationSettings : {};
  const simDungeon = Object.prototype.hasOwnProperty.call(snapshot, 'simDungeon')
    ? Boolean(snapshot.simDungeon)
    : Boolean(fallback.useDungeon);
  const selectedZoneHrid = String(snapshot.zoneHrid || '');
  const regularZoneHrid = String(
    snapshot.regularZoneHrid || (!simDungeon ? selectedZoneHrid : '') || fallback.zoneHrid || '',
  );
  const dungeonHrid = String(
    snapshot.dungeonHrid || (simDungeon ? selectedZoneHrid : '') || fallback.dungeonHrid || '',
  );
  const simulationSettings = {
    ...deepClone(fallback),
    mode: String(snapshot.mode || fallback.mode || 'zone'),
    runScope: String(snapshot.runScope || fallback.runScope || RUN_SCOPE_SINGLE),
    useDungeon: simDungeon,
    zoneHrid: simDungeon ? regularZoneHrid : selectedZoneHrid || regularZoneHrid,
    dungeonHrid: simDungeon ? selectedZoneHrid || dungeonHrid : dungeonHrid,
    difficultyTier: Math.max(0, Math.floor(toFiniteNumber(snapshot.difficultyTier, fallback.difficultyTier ?? 0))),
    simulationTimeHours: Math.max(
      1,
      Math.floor(toFiniteNumber(snapshot.simulationTimeHours, fallback.simulationTimeHours ?? 24)),
    ),
  };
  const payloadOptions = { simulationSettings };

  if (isPlainObject(snapshot.extra)) {
    payloadOptions.extra = deepClone(snapshot.extra);
  }

  return payloadOptions;
}

function sortQueueRawRuns(rows = [], entrySortIndexById = new Map()) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
    const roundDiff = Number(a?.round || 0) - Number(b?.round || 0);
    if (roundDiff !== 0) {
      return roundDiff;
    }
    return (entrySortIndexById.get(a?.id) ?? 999) - (entrySortIndexById.get(b?.id) ?? 999);
  });
}

function queueChangeNeedsAbilityUpgradeReference(change) {
  if (String(change?.kind || '') !== 'ability') {
    return false;
  }

  const afterHrid = String(change?.afterAbilityHrid || '');
  if (!afterHrid) {
    return false;
  }

  const beforeHrid = String(change?.beforeAbilityHrid || '');
  const beforeLevel = Math.max(1, Math.floor(toFiniteNumber(change?.beforeLevel, 1)));
  const afterLevel = Math.max(1, Math.floor(toFiniteNumber(change?.afterLevel, 1)));
  const fromLevel = beforeHrid && beforeHrid === afterHrid ? beforeLevel : 1;
  return afterLevel > fromLevel;
}

function queueEntriesNeedAbilityUpgradeReference(entries = []) {
  return (entries ?? []).some(
    (entry) =>
      Array.isArray(entry?.changeDetails) &&
      entry.changeDetails.some((change) => queueChangeNeedsAbilityUpgradeReference(change)),
  );
}

export function createQueueActions({ ensureQueueMarketPriceSnapshot, loadPlayerMapperModule, workerClient }) {
  return {
    ensureQueueState(playerId = this.activePlayerId) {
      const normalizedId = String(playerId || this.activePlayerId);
      if (!this.queue.byPlayer[normalizedId]) {
        this.queue.byPlayer[normalizedId] = createQueuePlayerState(
          loadQueueRunSettingsByPlayerFromStorage()?.[normalizedId],
        );
      }
      return this.queue.byPlayer[normalizedId];
    },
    setImportedProfileState(playerId, imported = true) {
      const normalizedId = String(playerId || '');
      if (!normalizedId) {
        return false;
      }
      if (!this.queue.importedProfileByPlayer || typeof this.queue.importedProfileByPlayer !== 'object') {
        this.queue.importedProfileByPlayer = createImportedProfileByPlayer();
      }
      this.queue.importedProfileByPlayer[normalizedId] = Boolean(imported);
      if (!imported) {
        this.setImportedBaselineSnapshot(normalizedId, null);
      }
      return true;
    },
    setImportedBaselineSnapshot(playerId, snapshot = null) {
      const normalizedId = String(playerId || '');
      if (!normalizedId) {
        return false;
      }
      if (!this.queue.importedBaselineByPlayer || typeof this.queue.importedBaselineByPlayer !== 'object') {
        this.queue.importedBaselineByPlayer = createImportedBaselineByPlayer();
      }
      this.queue.importedBaselineByPlayer[normalizedId] = isPlainObject(snapshot) ? deepClone(snapshot) : null;
      return true;
    },
    async setQueueBaselineForActivePlayer(options = {}) {
      const queueState = this.ensureQueueState(this.activePlayerId);

      const shouldRunSimulation = options?.runSimulation === true;
      const preserveQueueItems = options?.preserveQueueItems !== false;
      const activePlayerId = String(this.activePlayerId);
      const activePlayer = this.players.find((player) => String(player.id) === activePlayerId) ?? this.activePlayer;
      const partySnapshot = createQueuePartySnapshot(this.players, activePlayerId);
      const preservedQueueItems = preserveQueueItems && Array.isArray(queueState.items) ? queueState.items.slice() : [];

      if (!activePlayer) {
        throw new Error('Active player is missing.');
      }

      if (!shouldRunSimulation) {
        queueState.baseline = createQueueBaselineRecord(
          this.activePlayer,
          partySnapshot,
          buildQueueBaselineSettings(this.simulationSettings, queueState.settings),
        );
        queueState.items = preserveQueueItems ? preservedQueueItems : [];
        queueState.results = [];
        queueState.rawRuns = [];
        queueState.ranking = [];
        queueState.abilityUpgradeCosts = {};
        queueState.error = '';
        queueState.progress = 0;
        queueState.lastRunStatus = 'idle';
        queueState.cancelRequested = false;
        return queueState.baseline;
      }

      if (this.queue.importedProfileByPlayer?.[activePlayerId] !== true) {
        throw new Error('common:queue.requireImportBeforeBaseline');
      }

      if (this.runtime.isRunning || this.isAnyQueueRunning || this.advisor.runtime?.isRunning) {
        throw new Error('common:queue.errorBusy');
      }

      if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
        throw new Error('common:queue.errorBaselineRunScopeSingle');
      }

      if (this.simulationSettings.mode === 'labyrinth') {
        throw new Error('common:queue.errorBaselineNoLabyrinth');
      }

      const queueSettings = normalizeQueueSettings(queueState.settings);
      queueState.settings = queueSettings;
      const baselineRoundCount = queueSettings.baselineRounds;
      const executionMode = queueSettings.executionMode === 'parallel' ? 'parallel' : 'serial';
      const baselineSettings = buildQueueBaselineSettings(this.simulationSettings, queueSettings);
      const baselineSnapshot = deepClone(activePlayer);
      const scenarioPlayers = partySnapshot.selectedPlayers.map((player) => ({
        ...deepClone(player),
        selected: true,
      }));
      const { buildPlayersForSimulation } = await loadPlayerMapperModule();
      const playersToSim = buildPlayersForSimulation(scenarioPlayers);
      const baselinePayloadOptions = buildQueueBaselinePayloadOptions(baselineSettings, this.simulationSettings);
      if (playersToSim.length === 0) {
        throw new Error('common:queue.errorBuildPlayerData');
      }

      const selectedPlayersSnapshot = [{ id: activePlayerId, name: activePlayer?.name || `Player ${activePlayerId}` }];
      const pricingOptions = createProfitPricingOptions(this.pricing);
      const startedAt = Date.now();

      queueState.isRunning = true;
      queueState.cancelRequested = false;
      queueState.progress = 0;
      queueState.error = '';
      this.runtime.isRunning = true;
      this.runtime.progress = 0;
      this.runtime.error = '';
      this.runtime.startedAt = startedAt;
      this.runtime.elapsedSeconds = 0;
      this.runtime.workerMode = executionMode === 'parallel' ? 'multi' : 'single';

      try {
        let settledRounds = 0;
        const runProgressByRunKey = new Map();
        const roundResults = [];
        const roundFailures = [];
        const sampleMetadata = [];
        let representativeSimResult = null;
        const queueParallelWorkerLimit =
          executionMode === 'parallel'
            ? Math.max(
                1,
                Math.min(
                  normalizeParallelWorkerLimit(this.queueRuntime?.parallelWorkerLimit, this.queueParallelWorkerHardMax),
                  this.queueParallelWorkerHardMax,
                ),
              )
            : 1;

        const isBaselineRunActive = () => queueState.cancelRequested !== true;
        const ensureBaselineRunNotCancelled = () => {
          if (!isBaselineRunActive()) {
            throw createWorkerRunCancellationError('Queue baseline cancelled.');
          }
        };
        const updateBaselineRunProgress = () => {
          const inProgress = Array.from(runProgressByRunKey.values()).reduce(
            (sum, value) => sum + clamp(Number(value || 0), 0, 1),
            0,
          );
          const overall = (settledRounds + inProgress) / Math.max(1, baselineRoundCount);
          queueState.progress = clamp(overall, 0, 1);
          this.runtime.progress = queueState.progress;
          this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
        };
        const runBaselineRound = async (roundIndex) => {
          ensureBaselineRunNotCancelled();
          const runKey = `baseline-${roundIndex + 1}`;
          const runSingle =
            executionMode === 'parallel'
              ? this.runSingleSimulationPayloadWithDedicatedWorker
              : this.runSingleSimulationPayload;
          runProgressByRunKey.set(runKey, 0);
          updateBaselineRunProgress();
          let roundSettled = false;

          try {
            const payload = this.buildSingleSimulationPayload(playersToSim, baselinePayloadOptions);
            const simResult = await runSingle(payload, (data) => {
              if (!isBaselineRunActive()) {
                return;
              }
              runProgressByRunKey.set(runKey, clamp(Number(data.progress || 0), 0, 1));
              updateBaselineRunProgress();
            });

            ensureBaselineRunNotCancelled();
            const summaryRow = summarizeResult(simResult, selectedPlayersSnapshot, pricingOptions)[0] || null;
            const summaryMetrics = summarizeQueueBaselineMetrics(summaryRow);
            const queueMetrics = computeQueueMetrics(simResult, activePlayerId, pricingOptions);
            roundResults.push({
              round: roundIndex + 1,
              metrics: {
                ...summaryMetrics,
                ...queueMetrics,
              },
            });
            sampleMetadata.push({
              round: roundIndex + 1,
              simulatedTime: toFiniteNumber(simResult?.simulatedTime, 0),
              zoneHrid: String(simResult?.zoneHrid || simResult?.zoneName || ''),
              difficultyTier: Math.max(0, Math.floor(toFiniteNumber(simResult?.difficultyTier, 0))),
            });
            representativeSimResult ??= simResult;
            roundSettled = true;
          } catch (error) {
            if (isWorkerRunCancelledError(error)) {
              throw error;
            }
            roundFailures.push({
              round: roundIndex + 1,
              message: formatQueueErrorMessage(error),
            });
            roundSettled = true;
          } finally {
            runProgressByRunKey.delete(runKey);
            if (roundSettled) {
              settledRounds += 1;
            }
            updateBaselineRunProgress();
          }
        };

        if (executionMode === 'parallel' && baselineRoundCount > 1) {
          await runParallelWorkerPool({
            taskCount: baselineRoundCount,
            workerLimit: queueParallelWorkerLimit,
            ensureActive: () => ensureBaselineRunNotCancelled(),
            runTask: (roundIndex) => runBaselineRound(roundIndex),
          });
        } else {
          for (let roundIndex = 0; roundIndex < baselineRoundCount; roundIndex += 1) {
            ensureBaselineRunNotCancelled();
            // eslint-disable-next-line no-await-in-loop
            await runBaselineRound(roundIndex);
          }
        }

        ensureBaselineRunNotCancelled();
        const sortedRoundResults = roundResults.slice().sort((left, right) => left.round - right.round);
        if (sortedRoundResults.length <= 0) {
          throw new Error(roundFailures[0]?.message || 'common:queue.errorQueueBaselineFailed');
        }
        const baselineAggregate = buildQueueBaselineAggregate(sortedRoundResults, queueSettings.medianBlend);
        const sortedRoundFailures = roundFailures.slice().sort((left, right) => left.round - right.round);
        const partialFailureOverrides =
          sortedRoundFailures.length > 0
            ? {
                status: 'partial',
                failedRounds: sortedRoundFailures,
                failureSummary: {
                  failedRounds: sortedRoundFailures.length,
                  requestedRounds: baselineRoundCount,
                  message: formatPartialRunMessage(
                    'Queue baseline',
                    sortedRoundResults.length,
                    baselineRoundCount,
                    sortedRoundFailures,
                  ),
                },
              }
            : {};
        queueState.baseline = createQueueBaselineRecord(baselineSnapshot, partySnapshot, baselineSettings, {
          metrics: baselineAggregate.metrics,
          simResult: representativeSimResult,
          completedRounds: sortedRoundResults.length,
          metricSummary: baselineAggregate.metricSummary,
          sampleMetadata: sampleMetadata.slice().sort((left, right) => left.round - right.round),
          ...partialFailureOverrides,
        });
        queueState.items = preserveQueueItems ? preservedQueueItems : [];
        queueState.results = [];
        queueState.rawRuns = [];
        queueState.ranking = [];
        queueState.abilityUpgradeCosts = {};
        queueState.progress = 1;
        queueState.lastRunStatus = 'idle';
        queueState.error = sortedRoundFailures.length > 0 ? partialFailureOverrides.failureSummary.message : '';
        this.runtime.progress = 1;
        return queueState.baseline;
      } catch (error) {
        if (isWorkerRunCancelledError(error)) {
          queueState.error = '';
          this.runtime.error = '';
          throw error;
        }
        const errorMessage = formatQueueErrorMessage(error);
        queueState.error = errorMessage;
        throw new Error(errorMessage);
      } finally {
        queueState.isRunning = false;
        queueState.cancelRequested = false;
        this.runtime.isRunning = false;
        this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
        workerClient.stopSimulation();
        stopQueueWorkerClients();
      }
    },
    addActivePlayerToQueue(options = {}) {
      const invalidManualEntry = findInvalidManualEquipmentPriceEntry(options?.confirmedEquipmentPrices);
      if (invalidManualEntry) {
        throw createInvalidManualEquipmentPriceError(invalidManualEntry, invalidManualEntry?.method || 'manual');
      }
      const invalidSelection = findInvalidPriceSelection(options?.priceSelections);
      if (invalidSelection) {
        throw createInvalidManualEquipmentPriceError(invalidSelection, invalidSelection?.method || '');
      }
      const priceSelections = normalizeQueuePriceSelections(options?.priceSelections);
      const mergedConfirmedPrices = mergeConfirmedPricesAndSelections(options);
      const queueState = this.ensureQueueState(this.activePlayerId);
      if (this.activeQueuePartyStatus?.hasMismatch) {
        queueState.error = this.activeQueuePartyStatus.messageKey || 'common:queue.partyChangedSinceBaseline';
        return [];
      }
      if (!queueState.baseline?.snapshot) {
        return [];
      }

      const snapshot = deepClone(this.activePlayer);
      const changeSummary = computeQueueChangeSummary(queueState.baseline.snapshot, snapshot);
      if (changeSummary.count === 0) {
        return [];
      }

      const variants = buildQueueVariantSnapshotsFromChanges(queueState.baseline.snapshot, snapshot, changeSummary);
      if (variants.length === 0) {
        return [];
      }

      const saleSide = normalizeBaselineSaleSide(queueState.settings?.baselineSaleSide);

      const variantPricing = variants.map((variant) => {
        const inspections = inspectQueueEquipmentPricing(
          queueState.baseline.snapshot,
          variant.snapshot,
          this.pricing,
          mergedConfirmedPrices,
          { saleSide },
        );
        const invalid = inspections.find((inspection) => !inspection.targetAskAvailable);
        if (invalid) {
          const recentTrade = resolveRecentTradeAverage(this.pricing, invalid.afterItemHrid, invalid.afterLevel);
          if (recentTrade) {
            throw createEquipmentPriceConfirmationError([recentTrade]);
          }
          throw createMissingEquipmentAskError(invalid);
        }
        return {
          inspections,
          warnings: buildQueueCostWarnings(inspections),
          confirmedEquipmentPrices: normalizeConfirmedEquipmentPrices(
            inspections
              .filter((inspection) => inspection.confirmedPrice)
              .map((inspection) => ({
                ...inspection.confirmedPrice,
                confirmedAt: Date.now(),
              })),
          ),
        };
      });

      const appendedItems = variants.map((variant, variantIndex) => {
        const fallbackName = `Variant ${queueState.items.length + 1}`;
        // 入队时按 variant 裁剪 priceSelections：仅保留本 variant 实际变更装备的价格行，
        // 避免各 variant 冗余存储全量选择，把过滤责任推给所有消费方。
        const changedKeys = buildChangedEquipmentKeys({ snapshot: variant.snapshot }, queueState.baseline.snapshot);
        const variantPriceSelections = priceSelections.filter((selection) =>
          changedKeys.has(buildSelectionKey(selection.itemHrid, selection.enhancementLevel)),
        );
        const nextItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: String(variant?.name || fallbackName),
          snapshot: deepClone(variant.snapshot),
          changes: Array.isArray(variant.labels) ? variant.labels : [],
          changeDetails: Array.isArray(variant.changeDetails) ? deepClone(variant.changeDetails) : [],
          costWarnings: deepClone(variantPricing[variantIndex].warnings),
          confirmedEquipmentPrices: deepClone(variantPricing[variantIndex].confirmedEquipmentPrices),
          priceSelections: deepClone(variantPriceSelections),
          createdAt: Date.now(),
        };
        queueState.items.push(nextItem);
        return nextItem;
      });

      // 与旧流程保持等价：入队当前差异后，将编辑器状态恢复到基准。
      const baselineSnapshot = queueState.baseline?.snapshot ?? null;
      if (baselineSnapshot) {
        const currentActive = this.players.find((player) => String(player.id) === this.activePlayerId);
        const currentSelected = currentActive?.selected ?? true;
        const activePlayerId = String(this.activePlayerId);
        this.players = this.players.map((player) => {
          if (String(player.id) !== activePlayerId) {
            return player;
          }
          return this.ensurePlayerConfig({
            ...deepClone(baselineSnapshot),
            id: activePlayerId,
            selected: currentSelected,
          });
        });
      }
      queueState.results = [];
      queueState.rawRuns = [];
      queueState.ranking = [];
      queueState.error = '';
      queueState.lastRunStatus = 'idle';
      return appendedItems;
    },
    async prepareActivePlayerQueueAddition() {
      const queueState = this.ensureQueueState(this.activePlayerId);
      if (this.activeQueuePartyStatus?.hasMismatch || !queueState.baseline?.snapshot) {
        return { requiresConfirmation: false, rows: [], refreshFailed: false };
      }
      const snapshot = deepClone(this.activePlayer);
      const changeSummary = computeQueueChangeSummary(queueState.baseline.snapshot, snapshot);
      const variants = buildQueueVariantSnapshotsFromChanges(queueState.baseline.snapshot, snapshot, changeSummary);
      if (variants.length === 0) {
        return { requiresConfirmation: false, rows: [], refreshFailed: false };
      }

      const baselineSnapshot = queueState.baseline.snapshot;
      const saleSide = normalizeBaselineSaleSide(queueState.settings?.baselineSaleSide);
      // 先用当前 pricing 解析镜子价；若后续触发市场刷新，会在刷新后重新解析以对齐最新价格。
      let mirrorPrice =
        resolveReferenceEquipmentPrice(PHILOSOPHERS_MIRROR_ITEM_HRID, 0, this.pricing, [])?.price ?? null;

      // 预计算所有 variant 的 inspection 结果，供 findMissing 与后续行收集复用，
      // 避免对同一 variant 重复调用 inspectQueueEquipmentPricing（纯函数，输入不变则结果不变）。
      const buildAllInspections = () =>
        variants.map((variant) =>
          inspectQueueEquipmentPricing(baselineSnapshot, variant.snapshot, this.pricing, [], { saleSide }),
        );
      let allInspections = buildAllInspections();
      let missing = allInspections.flat().filter((inspection) => !inspection.targetAskAvailable);
      let refreshFailed = false;
      if (missing.length > 0) {
        const refreshState = await ensureQueueMarketPriceSnapshot(this);
        refreshFailed = refreshState.refreshFailed;
        // 刷新后 this.pricing 可能已变化，需重新计算 inspection 与 missing。
        allInspections = buildAllInspections();
        missing = allInspections.flat().filter((inspection) => !inspection.targetAskAvailable);
        // 镜子价同样需重新解析：刷新可能改变镜子本身的市场价，
        // 若沿用旧值，弹窗中的 autoMirrorPrice 与每行 mirrorPlan.cost 会与更新后的
        // pricingState 不一致（computeMirrorPlan 仅使用传入的 mirrorPrice，不自行解析）。
        mirrorPrice = resolveReferenceEquipmentPrice(PHILOSOPHERS_MIRROR_ITEM_HRID, 0, this.pricing, [])?.price ?? null;
      }

      // 收集所有变化装备行（无论是否有精确价），并解析参考价/基准出售价/镜子方案。
      const rows = [];
      const rowByKey = new Map();
      for (const inspections of allInspections) {
        for (const inspection of inspections) {
          const key = getConfirmedEquipmentPriceKey(inspection.afterItemHrid, inspection.afterLevel);
          const existing = rowByKey.get(key);
          if (existing) {
            if (!existing.slotKeys.includes(inspection.slotKey)) {
              existing.slotKeys.push(inspection.slotKey);
            }
            continue;
          }
          const reference = resolveReferenceEquipmentPrice(
            inspection.afterItemHrid,
            inspection.afterLevel,
            this.pricing,
            null,
          );
          const baselineSale = resolveBaselineSaleQuote(
            inspection.beforeItemHrid,
            inspection.beforeLevel,
            this.pricing,
            saleSide,
          );
          // 右一价：目标装备（要加入队列的装备）在市场上的最高收购价（bid 侧）。
          const targetBid = resolveBaselineSaleQuote(
            inspection.afterItemHrid,
            inspection.afterLevel,
            this.pricing,
            'bid',
          );
          const baselineLevel =
            String(inspection.beforeItemHrid || '') === String(inspection.afterItemHrid || '')
              ? inspection.beforeLevel
              : 0;
          const mirrorPlan = computeMirrorPlan({
            itemHrid: inspection.afterItemHrid,
            targetLevel: inspection.afterLevel,
            baselineLevel,
            pricingState: this.pricing,
            confirmedEquipmentPrices: [],
            mirrorPrice,
          });
          const row = {
            itemHrid: inspection.afterItemHrid,
            enhancementLevel: inspection.afterLevel,
            slotKey: inspection.slotKey,
            slotKeys: [inspection.slotKey],
            reference,
            baselineSale: baselineSale,
            targetBid,
            baselineSaleValue: inspection.baselineSaleValue,
            baselineSaleSource: inspection.baselineSaleSource,
            baselineSaleZero: inspection.baselineSaleZero,
            baselineLevel,
            mirrorPlan,
            usedBaselineLevels: Array.isArray(mirrorPlan?.usedBaselineLevels) ? mirrorPlan.usedBaselineLevels : [],
            mirrorPrice,
            hasExactAsk: inspection.targetAskAvailable,
            targetAsk: inspection.targetAsk,
            targetPriceSource: inspection.targetPriceSource,
            confirmedPrice: inspection.confirmedPrice,
          };
          rowByKey.set(key, row);
          rows.push(row);
        }
      }

      // 为缺价行补充历史 Ask（异步）。历史 Ask 是异步数据源（GitHub），不在 pricingState 中，
      // 需在此统一拉取后注入参考价列与镜子方案取价链，使口径一致（精确 Ask → 官方小时均价 → 历史 Ask → confirmed）。
      // 行目标级仅对缺价行（无精确 Ask 且无参考价）发起历史查询：有精确 Ask / 官方小时均价的行
      // 目标级已有同步价，无需查询（fetchAndCollectHistory 内部也按等级跳过同步可取值，请求零开销）。
      const historicalQuotes = new Map();
      const attemptedHistoryKeys = new Set();
      const fetchAndCollectHistory = async (itemHrid, enhancementLevel) => {
        const histKey = getConfirmedEquipmentPriceKey(itemHrid, enhancementLevel);
        if (historicalQuotes.has(histKey) || attemptedHistoryKeys.has(histKey)) {
          return;
        }
        // 同步链能取到价时无需历史 Ask，跳过网络请求（不缓存非历史数据到 historicalQuotes，
        // 因 resolveHistoricalQuote 仅为历史数据服务，混入同步价会语义不纯）。
        const syncQuote = resolveReferenceEquipmentPrice(itemHrid, enhancementLevel, this.pricing, null);
        if (syncQuote) {
          return;
        }
        // 发起请求前先登记"已尝试"：查询失败（null，如无历史数据/网络错误）不写入 historicalQuotes，
        // 但同一准备过程内该等级不再重复请求——覆盖第一轮（缺价行目标级）与第二轮
        // （mirrorPlan.missing 输入级，兜底分支会把目标级本身列入 missing）的同 key 交集，
        // 并顺带补齐第二轮并发同 key 的本地去重（marketHistoryService 层已有请求级缓存兜底）。
        attemptedHistoryKeys.add(histKey);
        const history = await marketHistoryService.getLatestAsk(itemHrid, enhancementLevel);
        if (history) {
          historicalQuotes.set(histKey, history);
        }
      };

      const missingRows = rows.filter((row) => !row.hasExactAsk && !row.reference);
      await Promise.all(
        missingRows.map(async (row) => {
          await fetchAndCollectHistory(row.itemHrid, row.enhancementLevel);
          // 同步取值：fetchAndCollectHistory 已将历史 Ask 写入 historicalQuotes，
          // 若取到则覆盖 row.reference（与原逻辑一致）。
          const histKey = getConfirmedEquipmentPriceKey(row.itemHrid, row.enhancementLevel);
          const history = historicalQuotes.get(histKey);
          if (history && history.source !== 'ask') {
            row.reference = history;
          }
        }),
      );

      // 为所有行的镜子方案缺价输入件补充历史 Ask（输入件等级可能与目标装备等级不同）。
      // mirrorPlan.missing 列出合成方案所需但取不到同步价的输入件等级；历史 Ask 可解锁这些等级。
      // 新交互模型下所有变更行都会进弹窗、镜子方式对任何行可选：目标装备有精确 Ask / 小时均价的行，
      // 其 mirrorPlan.missing 输入件同样需要历史 Ask 解锁，否则只能手动补价（G3：历史数据形同虚设）。
      // 请求量受控：fetchAndCollectHistory 已抓取去重 + 同步链可取值跳过，仅对真正缺价的等级发起请求。
      await Promise.all(
        rows.map(async (row) => {
          const missingItems = Array.isArray(row.mirrorPlan?.missing) ? row.mirrorPlan.missing : [];
          await Promise.all(
            missingItems.map(async (missingItem) => {
              await fetchAndCollectHistory(row.itemHrid, Number(missingItem.level));
            }),
          );
        }),
      );

      // 历史 Ask 到位后重算所有行镜子方案，使 mirrorPlan.cost 与参考价列口径一致。
      // 有精确 Ask / 官方小时均价的行目标级不会被拉取历史（同步链可取值），rowHistory 为空，
      // 下方 reference 覆盖守卫不会触发，参考价列不受影响。
      for (const row of rows) {
        const rowHistKey = getConfirmedEquipmentPriceKey(row.itemHrid, row.enhancementLevel);
        const rowHistory = historicalQuotes.get(rowHistKey);
        if (rowHistory && rowHistory.source !== 'ask' && !row.reference) {
          row.reference = rowHistory;
        }
        const mirrorPlan = computeMirrorPlan({
          itemHrid: row.itemHrid,
          targetLevel: row.enhancementLevel,
          baselineLevel: row.baselineLevel || 0,
          pricingState: this.pricing,
          confirmedEquipmentPrices: [],
          mirrorPrice,
          historicalQuotes,
        });
        row.mirrorPlan = mirrorPlan;
        row.usedBaselineLevels = Array.isArray(mirrorPlan?.usedBaselineLevels) ? mirrorPlan.usedBaselineLevels : [];
      }

      // 设计意图：只要存在装备变更（rows.length > 0）即弹出价格确认窗口，
      // 即使所有装备都有精确 ask 价（hasExactAsk = true）也不例外。
      // 旧逻辑仅在"缺价"（missing.length > 0）时弹窗，新逻辑改为"每次装备变更都弹窗"，
      // 目的是让用户在所有装备变更场景下都能选择定价方式（左一价/右一价/镜子方案/手工价），
      // 而不是在市场价可用时静默使用左一价入队。
      const requiresConfirmation = rows.length > 0;
      return { requiresConfirmation, rows, refreshFailed, mirrorPrice, historicalQuotes };
    },
    updateActiveQueueSettings(partialSettings = {}) {
      return this.updateQueueSettingsForPlayer(this.activePlayerId, partialSettings, {
        persist: true,
        ignorePersistError: true,
      });
    },
    updateQueueSettingsForPlayer(playerId = this.activePlayerId, partialSettings = {}, options = {}) {
      const normalizedPlayerId = String(playerId || this.activePlayerId);
      const queueState = this.ensureQueueState(normalizedPlayerId);
      const previousSettings = normalizeQueueSettings(queueState.settings);
      const nextSettings = normalizeQueueSettings({
        ...queueState.settings,
        ...partialSettings,
      });

      if (options?.persist !== false) {
        const queueStateByPlayerForPersist = {};
        for (const queuePlayerId of QUEUE_PLAYER_IDS) {
          queueStateByPlayerForPersist[queuePlayerId] = {
            settings:
              String(queuePlayerId) === normalizedPlayerId
                ? nextSettings
                : this.queue.byPlayer?.[queuePlayerId]?.settings,
          };
        }

        try {
          persistQueueRunSettingsByPlayerToStorage(queueStateByPlayerForPersist);
        } catch (error) {
          if (options?.ignorePersistError !== true) {
            throw error;
          }
        }
      }

      queueState.settings = nextSettings;
      const rankingSettingsChanged = haveQueueRunRankingSettingsChanged(previousSettings, queueState.settings);
      // 基准出售口径（baselineSaleSide）影响 equipmentSaleValue/equipmentNetCost/totalUpgradeCost →
      // costScore/finalScore，但不影响 baseline metrics（后者仅依赖 medianBlend，见
      // resolveQueueBaselineMetricsForSettings）。因此口径切换只单独触发结果重算，不并入
      // rankingSettingsChanged，避免多余的 baseline metrics 重算。
      const saleSideChanged = previousSettings.baselineSaleSide !== nextSettings.baselineSaleSide;
      if (rankingSettingsChanged && queueState?.baseline) {
        const refreshedBaselineMetrics = resolveQueueBaselineMetricsForSettings(
          queueState.baseline,
          queueState.settings,
        );
        if (isPlainObject(refreshedBaselineMetrics)) {
          queueState.baseline.metrics = {
            ...(isPlainObject(queueState.baseline.metrics) ? queueState.baseline.metrics : {}),
            ...refreshedBaselineMetrics,
          };
        }
      }
      if (
        (rankingSettingsChanged || saleSideChanged) &&
        Array.isArray(queueState?.rawRuns) &&
        queueState.rawRuns.length > 0
      ) {
        this.refreshQueueResultsFromRawRuns({
          playerId: normalizedPlayerId,
          includeEmptyEntries: queueState?.isRunning !== true && queueState?.lastRunStatus === 'completed',
          allowReferenceLoad: false,
          sortRawRuns: false,
          updateLastRunAt: false,
        });
      }
      return queueState.settings;
    },
    resetActiveQueueSettings() {
      return this.updateActiveQueueSettings(getDefaultQueueRunSettings());
    },
    async removeQueueItem(itemId) {
      const queueState = this.ensureQueueState(this.activePlayerId);
      const normalizedItemId = String(itemId || '');
      if (queueState.isRunning || !queueState.items.some((item) => String(item?.id || '') === normalizedItemId)) {
        return false;
      }
      queueState.items = queueState.items.filter((item) => String(item?.id || '') !== normalizedItemId);
      queueState.rawRuns = queueState.rawRuns.filter((row) => String(row?.id || '') !== normalizedItemId);
      if (queueState.items.length === 0) {
        queueState.results = [];
        queueState.ranking = [];
        queueState.rawRuns = [];
        queueState.progress = 0;
        queueState.error = '';
        queueState.lastRunAt = 0;
        queueState.lastRunStatus = 'idle';
        return true;
      }
      await this.refreshQueueResultsFromRawRuns({
        playerId: this.activePlayerId,
        includeEmptyEntries: false,
        allowReferenceLoad: false,
        sortRawRuns: true,
        updateLastRunAt: false,
      });
      return true;
    },
    clearActiveQueue() {
      const queueState = this.ensureQueueState(this.activePlayerId);
      queueState.items = [];
      queueState.results = [];
      queueState.rawRuns = [];
      queueState.ranking = [];
      queueState.progress = 0;
      queueState.error = '';
      queueState.lastRunStatus = 'idle';
    },
    loadQueueSnapshotToActivePlayer(snapshotId) {
      const queueState = this.ensureQueueState(this.activePlayerId);
      const activePlayerId = String(this.activePlayerId);
      const currentActive = this.players.find((player) => String(player.id) === activePlayerId);
      const currentSelected = currentActive?.selected ?? true;

      const normalizedSnapshotId = String(snapshotId || '').trim();
      if (!normalizedSnapshotId) {
        return false;
      }
      const targetSnapshot = queueState.items.find((item) => item.id === normalizedSnapshotId)?.snapshot ?? null;

      if (!targetSnapshot) {
        return false;
      }

      this.players = this.players.map((player) => {
        if (String(player.id) !== activePlayerId) {
          return player;
        }
        return this.ensurePlayerConfig({
          ...deepClone(targetSnapshot),
          id: activePlayerId,
          selected: currentSelected,
        });
      });
      this.persistPlayerAchievements();

      return true;
    },
    async refreshQueueResultsFromRawRuns(options = {}) {
      const playerId = String(options?.playerId || this.activePlayerId);
      const queueState = this.ensureQueueState(playerId);
      if (queueState.baseline?.snapshot) {
        const saleSide = normalizeBaselineSaleSide(queueState.settings?.baselineSaleSide);
        for (const item of queueState.items) {
          const confirmedEquipmentPrices = mergeConfirmedPricesAndSelections(item);
          const inspections = inspectQueueEquipmentPricing(
            queueState.baseline.snapshot,
            item?.snapshot,
            this.pricing,
            confirmedEquipmentPrices,
            { saleSide },
          );
          item.costWarnings = buildQueueCostWarnings(inspections);
        }
      }
      const entries = buildQueueEntriesFromState(queueState);
      const entrySortIndexById = new Map(entries.map((entry, index) => [entry.id, index]));
      const includeEmptyEntries = options?.includeEmptyEntries === true;
      const allowReferenceLoad = options?.allowReferenceLoad !== false;

      if (entries.length === 0) {
        queueState.results = [];
        queueState.ranking = [];
        if (options?.sortRawRuns !== false) {
          queueState.rawRuns = [];
        }
        return [];
      }

      if (
        allowReferenceLoad &&
        queueEntriesNeedAbilityUpgradeReference(entries) &&
        !hasAbilityUpgradeReferenceDataLoaded()
      ) {
        await this.ensureAbilityUpgradeReferenceDataLoaded();
      }

      const queueSettings = normalizeQueueSettings(queueState.settings);
      queueState.settings = queueSettings;
      const baselineMetrics = resolveQueueBaselineMetricsForSettings(queueState?.baseline, queueSettings);
      if (queueState?.baseline && isPlainObject(baselineMetrics)) {
        queueState.baseline.metrics = {
          ...(isPlainObject(queueState.baseline.metrics) ? queueState.baseline.metrics : {}),
          ...baselineMetrics,
        };
      }
      syncQueueRawRunDeltas(queueState.rawRuns, isPlainObject(baselineMetrics) ? baselineMetrics : {});
      const rankedRows = buildQueueRankedRowsFromSampleState({
        entries,
        rawRuns: queueState.rawRuns,
        queueSettings,
        queueState,
        baselineMetrics: isPlainObject(baselineMetrics) ? baselineMetrics : {},
        pricingState: this.pricing,
        queueRuntimeSettings: this.queueRuntime,
        includeEmptyEntries,
        costDependencies: {
          inspectQueueEquipmentPricing,
          computeQueueItemUpgradeCost,
        },
      });

      queueState.results = rankedRows;
      queueState.ranking = rankedRows;
      if (options?.sortRawRuns !== false) {
        queueState.rawRuns = sortQueueRawRuns(queueState.rawRuns, entrySortIndexById);
      }
      if (options?.updateLastRunAt === true) {
        queueState.lastRunAt = Date.now();
      }

      return rankedRows;
    },
    refreshStoredQueueRankingsForCurrentSettings() {
      for (const [playerId, queueState] of Object.entries(this.queue?.byPlayer || {})) {
        if (!Array.isArray(queueState?.rawRuns) || queueState.rawRuns.length <= 0) {
          continue;
        }

        this.refreshQueueResultsFromRawRuns({
          playerId,
          includeEmptyEntries: queueState?.isRunning !== true && queueState?.lastRunStatus === 'completed',
          allowReferenceLoad: false,
          sortRawRuns: false,
          updateLastRunAt: false,
        });
      }
    },
    async runActiveQueue() {
      return executeActiveQueueRun({
        store: this,
        loadPlayerMapperModule,
        workerClient,
        buildQueuePartySelectedPlayers,
        buildQueueBaselinePayloadOptions,
        buildQueueEntriesFromState,
        computeQueueMetricDeltas,
        syncQueueRawRunDeltas,
      });
    },
  };
}
