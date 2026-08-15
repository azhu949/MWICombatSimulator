import marketHistoryService from "../services/marketHistoryService.js";
import {
    createProfitPricingOptions,
    loadQueueRunSettingsByPlayerFromStorage,
    persistQueueRunSettingsByPlayerToStorage,
} from "../services/simulatorStorage.js";
import {
    createWorkerRunCancellationError,
    isWorkerRunCancelledError,
    stopQueueWorkerClients,
} from "../services/simulatorWorkerRuns.js";
import {
    RUN_SCOPE_SINGLE,
    buildQueueBaselineSettings,
    computeQueueMetrics,
    summarizeQueueBaselineMetrics,
    summarizeResult,
} from "../services/simulationDomain.js";
import {
    MANUAL_EQUIPMENT_PRICE_SOURCE,
    buildQueueBaselineAggregate,
    buildQueueRankedRowsFromSampleState,
    getDefaultQueueRunSettings,
    haveQueueRunRankingSettingsChanged,
    normalizeParallelWorkerLimit,
    normalizeQueueSettings,
    resolveQueueBaselineMetricsForSettings,
} from "../services/queueScoring.js";
import {
    buildQueueVariantSnapshotsFromChanges,
    computeQueueChangeSummary,
    deriveQueueVariantNameFromLabels,
} from "../services/queueVariants.js";
import { executeActiveQueueRun } from "../services/queueRunExecution.js";
import { runParallelWorkerPool } from "../services/workerPool.js";
import {
    buildQueueCostWarnings,
    computeQueueItemUpgradeCost,
    createEquipmentPriceConfirmationError,
    createInvalidManualEquipmentPriceError,
    createMissingEquipmentAskError,
    findInvalidManualEquipmentPriceEntry,
    getConfirmedEquipmentPriceKey,
    hasAbilityUpgradeReferenceDataLoaded,
    inspectQueueEquipmentPricing,
    normalizeConfirmedEquipmentPrices,
    resolveRecentTradeAverage,
} from "../services/queueUpgradeCost.js";
import { clamp, deepClone, isPlainObject, toFiniteNumber } from "../services/utils.js";

export const QUEUE_PLAYER_IDS = ["1", "2", "3", "4", "5"];

function formatQueueErrorMessage(error, fallback = "Simulation failed.") {
    if (typeof error === "string" && error.trim()) {
        return error;
    }
    if (error?.message) {
        return String(error.message);
    }
    try {
        const serialized = JSON.stringify(error);
        return serialized && serialized !== "null" ? serialized : fallback;
    } catch {
        return fallback;
    }
}

function formatPartialRunMessage(label, successfulCount, totalCount, failures = []) {
    const failureCount = Array.isArray(failures) ? failures.length : 0;
    const firstFailure = failures.find((failure) => failure?.message)?.message || "Unknown error.";
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
        error: "",
        lastRunAt: 0,
        lastRunStatus: "idle",
        runId: 0,
        cancelRequested: false,
    };
}

function buildQueuePartySelectedPlayers(players = [], activePlayerId = "1") {
    const normalizedActivePlayerId = String(activePlayerId || "1");
    const safePlayers = Array.isArray(players) ? players : [];
    const selectedPlayers = [];
    let activeIncluded = false;

    for (const player of safePlayers) {
        if (!player) {
            continue;
        }

        const clonedPlayer = deepClone(player);
        const isActivePlayer = String(clonedPlayer.id || "") === normalizedActivePlayerId;
        if (!isActivePlayer && clonedPlayer.selected !== true) {
            continue;
        }

        clonedPlayer.selected = true;
        selectedPlayers.push(clonedPlayer);
        activeIncluded = activeIncluded || isActivePlayer;
    }

    if (!activeIncluded) {
        const activePlayer = safePlayers.find((player) => String(player?.id || "") === normalizedActivePlayerId);
        if (activePlayer) {
            const clonedPlayer = deepClone(activePlayer);
            clonedPlayer.selected = true;
            selectedPlayers.unshift(clonedPlayer);
        }
    }

    return selectedPlayers;
}

export function buildQueuePartyComparisonPlayers(players = [], activePlayerId = "1") {
    const normalizedActivePlayerId = String(activePlayerId || "1");
    return buildQueuePartySelectedPlayers(players, activePlayerId)
        .filter((player) => String(player?.id || "") !== normalizedActivePlayerId)
        .map((player) => ({
            ...deepClone(player),
            selected: true,
        }))
        .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));
}

export function buildQueuePartySignature(players = [], activePlayerId = "1") {
    return JSON.stringify(buildQueuePartyComparisonPlayers(players, activePlayerId));
}

function createQueuePartySnapshot(players = [], activePlayerId = "1") {
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

    return (Array.isArray(queueState?.items) ? queueState.items : []).map((item, index) => {
        const summary = computeQueueChangeSummary(baselineSnapshot, item?.snapshot);
        const fallbackLabels = Array.isArray(summary?.labels) ? summary.labels : [];
        const fallbackChangeDetails = Array.isArray(summary?.changes) ? summary.changes : [];
        const changes = Array.isArray(item?.changes) && item.changes.length > 0
            ? item.changes
            : fallbackLabels;
        const changeDetails = Array.isArray(item?.changeDetails) && item.changeDetails.length > 0
            ? deepClone(item.changeDetails)
            : deepClone(fallbackChangeDetails);
        const itemName = String(item?.name || "").trim();
        const label = itemName || deriveQueueVariantNameFromLabels(changes, index + 1);

        return {
            id: item?.id,
            label,
            snapshot: deepClone(item?.snapshot),
            changes,
            changeDetails,
            confirmedEquipmentPrices: normalizeConfirmedEquipmentPrices(item?.confirmedEquipmentPrices),
        };
    }).filter((entry) => Boolean(entry.id));
}

function buildQueueBaselinePayloadOptions(baselineSettings = {}, fallbackSimulationSettings = {}) {
    const snapshot = isPlainObject(baselineSettings) ? baselineSettings : {};
    const fallback = isPlainObject(fallbackSimulationSettings) ? fallbackSimulationSettings : {};
    const simDungeon = Object.prototype.hasOwnProperty.call(snapshot, "simDungeon")
        ? Boolean(snapshot.simDungeon)
        : Boolean(fallback.useDungeon);
    const selectedZoneHrid = String(snapshot.zoneHrid || "");
    const regularZoneHrid = String(
        snapshot.regularZoneHrid
        || (!simDungeon ? selectedZoneHrid : "")
        || fallback.zoneHrid
        || ""
    );
    const dungeonHrid = String(
        snapshot.dungeonHrid
        || (simDungeon ? selectedZoneHrid : "")
        || fallback.dungeonHrid
        || ""
    );
    const simulationSettings = {
        ...deepClone(fallback),
        mode: String(snapshot.mode || fallback.mode || "zone"),
        runScope: String(snapshot.runScope || fallback.runScope || RUN_SCOPE_SINGLE),
        useDungeon: simDungeon,
        zoneHrid: simDungeon ? regularZoneHrid : (selectedZoneHrid || regularZoneHrid),
        dungeonHrid: simDungeon ? (selectedZoneHrid || dungeonHrid) : dungeonHrid,
        difficultyTier: Math.max(0, Math.floor(toFiniteNumber(snapshot.difficultyTier, fallback.difficultyTier ?? 0))),
        simulationTimeHours: Math.max(1, Math.floor(toFiniteNumber(snapshot.simulationTimeHours, fallback.simulationTimeHours ?? 24))),
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
    if (String(change?.kind || "") !== "ability") {
        return false;
    }

    const afterHrid = String(change?.afterAbilityHrid || "");
    if (!afterHrid) {
        return false;
    }

    const beforeHrid = String(change?.beforeAbilityHrid || "");
    const beforeLevel = Math.max(1, Math.floor(toFiniteNumber(change?.beforeLevel, 1)));
    const afterLevel = Math.max(1, Math.floor(toFiniteNumber(change?.afterLevel, 1)));
    const fromLevel = beforeHrid && beforeHrid === afterHrid ? beforeLevel : 1;
    return afterLevel > fromLevel;
}

function queueEntriesNeedAbilityUpgradeReference(entries = []) {
    return (entries ?? []).some((entry) => (
        Array.isArray(entry?.changeDetails)
        && entry.changeDetails.some((change) => queueChangeNeedsAbilityUpgradeReference(change))
    ));
}

export function createQueueActions({
    ensureQueueMarketPriceSnapshot,
    loadPlayerMapperModule,
    workerClient,
}) {
    return {
        ensureQueueState(playerId = this.activePlayerId) {
            const normalizedId = String(playerId || this.activePlayerId);
            if (!this.queue.byPlayer[normalizedId]) {
                this.queue.byPlayer[normalizedId] = createQueuePlayerState(
                    loadQueueRunSettingsByPlayerFromStorage()?.[normalizedId]
                );
            }
            return this.queue.byPlayer[normalizedId];
        },
        setImportedProfileState(playerId, imported = true) {
            const normalizedId = String(playerId || "");
            if (!normalizedId) {
                return false;
            }
            if (!this.queue.importedProfileByPlayer || typeof this.queue.importedProfileByPlayer !== "object") {
                this.queue.importedProfileByPlayer = createImportedProfileByPlayer();
            }
            this.queue.importedProfileByPlayer[normalizedId] = Boolean(imported);
            if (!imported) {
                this.setImportedBaselineSnapshot(normalizedId, null);
            }
            return true;
        },
        setImportedBaselineSnapshot(playerId, snapshot = null) {
            const normalizedId = String(playerId || "");
            if (!normalizedId) {
                return false;
            }
            if (!this.queue.importedBaselineByPlayer || typeof this.queue.importedBaselineByPlayer !== "object") {
                this.queue.importedBaselineByPlayer = createImportedBaselineByPlayer();
            }
            this.queue.importedBaselineByPlayer[normalizedId] = isPlainObject(snapshot)
                ? deepClone(snapshot)
                : null;
            return true;
        },
        async setQueueBaselineForActivePlayer(options = {}) {
            const queueState = this.ensureQueueState(this.activePlayerId);

            const shouldRunSimulation = options?.runSimulation === true;
            const preserveQueueItems = options?.preserveQueueItems !== false;
            const activePlayerId = String(this.activePlayerId);
            const activePlayer = this.players.find((player) => String(player.id) === activePlayerId) ?? this.activePlayer;
            const partySnapshot = createQueuePartySnapshot(this.players, activePlayerId);
            const preservedQueueItems = preserveQueueItems && Array.isArray(queueState.items)
                ? queueState.items.slice()
                : [];

            if (!activePlayer) {
                throw new Error("Active player is missing.");
            }

            if (!shouldRunSimulation) {
                queueState.baseline = createQueueBaselineRecord(
                    this.activePlayer,
                    partySnapshot,
                    buildQueueBaselineSettings(this.simulationSettings, queueState.settings)
                );
                queueState.items = preserveQueueItems ? preservedQueueItems : [];
                queueState.results = [];
                queueState.rawRuns = [];
                queueState.ranking = [];
                queueState.abilityUpgradeCosts = {};
                queueState.error = "";
                queueState.progress = 0;
                queueState.lastRunStatus = "idle";
                queueState.cancelRequested = false;
                return queueState.baseline;
            }

            if (this.queue.importedProfileByPlayer?.[activePlayerId] !== true) {
                throw new Error("common:queue.requireImportBeforeBaseline");
            }

            if (this.runtime.isRunning || this.isAnyQueueRunning || this.advisor.runtime?.isRunning) {
                throw new Error("common:queue.errorBusy");
            }

            if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
                throw new Error("common:queue.errorBaselineRunScopeSingle");
            }

            if (this.simulationSettings.mode === "labyrinth") {
                throw new Error("common:queue.errorBaselineNoLabyrinth");
            }

            const queueSettings = normalizeQueueSettings(queueState.settings);
            queueState.settings = queueSettings;
            const baselineRoundCount = queueSettings.baselineRounds;
            const executionMode = queueSettings.executionMode === "parallel" ? "parallel" : "serial";
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
                throw new Error("common:queue.errorBuildPlayerData");
            }

            const selectedPlayersSnapshot = [{ id: activePlayerId, name: activePlayer?.name || `Player ${activePlayerId}` }];
            const pricingOptions = createProfitPricingOptions(this.pricing);
            const startedAt = Date.now();

            queueState.isRunning = true;
            queueState.cancelRequested = false;
            queueState.progress = 0;
            queueState.error = "";
            this.runtime.isRunning = true;
            this.runtime.progress = 0;
            this.runtime.error = "";
            this.runtime.startedAt = startedAt;
            this.runtime.elapsedSeconds = 0;
            this.runtime.workerMode = executionMode === "parallel" ? "multi" : "single";

            try {
                let settledRounds = 0;
                const runProgressByRunKey = new Map();
                const roundResults = [];
                const roundFailures = [];
                const sampleMetadata = [];
                let representativeSimResult = null;
                const queueParallelWorkerLimit = executionMode === "parallel"
                    ? Math.max(
                        1,
                        Math.min(
                            normalizeParallelWorkerLimit(this.queueRuntime?.parallelWorkerLimit, this.queueParallelWorkerHardMax),
                            this.queueParallelWorkerHardMax
                        )
                    )
                    : 1;

                const isBaselineRunActive = () => queueState.cancelRequested !== true;
                const ensureBaselineRunNotCancelled = () => {
                    if (!isBaselineRunActive()) {
                        throw createWorkerRunCancellationError("Queue baseline cancelled.");
                    }
                };
                const updateBaselineRunProgress = () => {
                    const inProgress = Array.from(runProgressByRunKey.values())
                        .reduce((sum, value) => sum + clamp(Number(value || 0), 0, 1), 0);
                    const overall = (settledRounds + inProgress) / Math.max(1, baselineRoundCount);
                    queueState.progress = clamp(overall, 0, 1);
                    this.runtime.progress = queueState.progress;
                    this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                };
                const runBaselineRound = async (roundIndex) => {
                    ensureBaselineRunNotCancelled();
                    const runKey = `baseline-${roundIndex + 1}`;
                    const runSingle = executionMode === "parallel"
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
                            zoneHrid: String(simResult?.zoneHrid || simResult?.zoneName || ""),
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

                if (executionMode === "parallel" && baselineRoundCount > 1) {
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
                    throw new Error(roundFailures[0]?.message || "common:queue.errorQueueBaselineFailed");
                }
                const baselineAggregate = buildQueueBaselineAggregate(sortedRoundResults, queueSettings.medianBlend);
                const sortedRoundFailures = roundFailures.slice().sort((left, right) => left.round - right.round);
                const partialFailureOverrides = sortedRoundFailures.length > 0
                    ? {
                        status: "partial",
                        failedRounds: sortedRoundFailures,
                        failureSummary: {
                            failedRounds: sortedRoundFailures.length,
                            requestedRounds: baselineRoundCount,
                            message: formatPartialRunMessage(
                                "Queue baseline",
                                sortedRoundResults.length,
                                baselineRoundCount,
                                sortedRoundFailures
                            ),
                        },
                    }
                    : {};
                queueState.baseline = createQueueBaselineRecord(
                    baselineSnapshot,
                    partySnapshot,
                    baselineSettings,
                    {
                        metrics: baselineAggregate.metrics,
                        simResult: representativeSimResult,
                        completedRounds: sortedRoundResults.length,
                        metricSummary: baselineAggregate.metricSummary,
                        sampleMetadata: sampleMetadata.slice().sort((left, right) => left.round - right.round),
                        ...partialFailureOverrides,
                    }
                );
                queueState.items = preserveQueueItems ? preservedQueueItems : [];
                queueState.results = [];
                queueState.rawRuns = [];
                queueState.ranking = [];
                queueState.abilityUpgradeCosts = {};
                queueState.progress = 1;
                queueState.lastRunStatus = "idle";
                queueState.error = sortedRoundFailures.length > 0
                    ? partialFailureOverrides.failureSummary.message
                    : "";
                this.runtime.progress = 1;
                return queueState.baseline;
            } catch (error) {
                if (isWorkerRunCancelledError(error)) {
                    queueState.error = "";
                    this.runtime.error = "";
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
                throw createInvalidManualEquipmentPriceError(invalidManualEntry);
            }
            const confirmedEquipmentPrices = normalizeConfirmedEquipmentPrices(options?.confirmedEquipmentPrices);
            const queueState = this.ensureQueueState(this.activePlayerId);
            if (this.activeQueuePartyStatus?.hasMismatch) {
                queueState.error = this.activeQueuePartyStatus.messageKey || "common:queue.partyChangedSinceBaseline";
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

            const variantPricing = variants.map((variant) => {
                const inspections = inspectQueueEquipmentPricing(
                    queueState.baseline.snapshot,
                    variant.snapshot,
                    this.pricing,
                    confirmedEquipmentPrices
                );
                const invalid = inspections.find((inspection) => !inspection.targetAskAvailable);
                if (invalid) {
                    const recentTrade = resolveRecentTradeAverage(
                        this.pricing,
                        invalid.afterItemHrid,
                        invalid.afterLevel
                    );
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
                            }))
                    ),
                };
            });

            const appendedItems = variants.map((variant, variantIndex) => {
                const fallbackName = `Variant ${queueState.items.length + 1}`;
                const nextItem = {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: String(variant?.name || fallbackName),
                    snapshot: deepClone(variant.snapshot),
                    changes: Array.isArray(variant.labels) ? variant.labels : [],
                    changeDetails: Array.isArray(variant.changeDetails) ? deepClone(variant.changeDetails) : [],
                    costWarnings: deepClone(variantPricing[variantIndex].warnings),
                    confirmedEquipmentPrices: deepClone(variantPricing[variantIndex].confirmedEquipmentPrices),
                    createdAt: Date.now(),
                };
                queueState.items.push(nextItem);
                return nextItem;
            });

            // Keep parity with legacy flow: after queueing current diff, return editor state to baseline.
            const baselineSnapshot = queueState.baseline?.snapshot ?? null;
            if (baselineSnapshot) {
                const currentActive = this.players.find((player) => String(player.id) === this.activePlayerId);
                const currentSelected = currentActive?.selected ?? true;
                const activePlayerId = String(this.activePlayerId);
                this.players = this.players.map((player) => {
                    if (String(player.id) !== activePlayerId) {
                        return player;
                    }
                    return {
                        ...deepClone(baselineSnapshot),
                        id: activePlayerId,
                        selected: currentSelected,
                    };
                });
            }
            queueState.results = [];
            queueState.rawRuns = [];
            queueState.ranking = [];
            queueState.error = "";
            queueState.lastRunStatus = "idle";
            return appendedItems;
        },
        async prepareActivePlayerQueueAddition() {
            const queueState = this.ensureQueueState(this.activePlayerId);
            if (this.activeQueuePartyStatus?.hasMismatch || !queueState.baseline?.snapshot) {
                return { requiresConfirmation: false, confirmations: [] };
            }
            const snapshot = deepClone(this.activePlayer);
            const changeSummary = computeQueueChangeSummary(queueState.baseline.snapshot, snapshot);
            const variants = buildQueueVariantSnapshotsFromChanges(queueState.baseline.snapshot, snapshot, changeSummary);
            if (variants.length === 0) {
                return { requiresConfirmation: false, confirmations: [] };
            }
            const findMissing = () => variants.flatMap((variant) => (
                inspectQueueEquipmentPricing(queueState.baseline.snapshot, variant.snapshot, this.pricing)
                    .filter((inspection) => !inspection.targetAskAvailable)
            ));
            let missing = findMissing();
            let refreshFailed = false;
            if (missing.length > 0) {
                const refreshState = await ensureQueueMarketPriceSnapshot(this);
                refreshFailed = refreshState.refreshFailed;
                missing = findMissing();
            }
            if (missing.length === 0) {
                return { requiresConfirmation: false, confirmations: [], refreshFailed };
            }
            const confirmationRequests = [];
            const confirmationByKey = new Map();
            for (const inspection of missing) {
                const key = getConfirmedEquipmentPriceKey(inspection.afterItemHrid, inspection.afterLevel);
                const existing = confirmationByKey.get(key);
                if (existing) {
                    if (!existing.slotKeys.includes(inspection.slotKey)) {
                        existing.slotKeys.push(inspection.slotKey);
                    }
                    continue;
                }
                const request = {
                    inspection,
                    confirmation: resolveRecentTradeAverage(
                        this.pricing,
                        inspection.afterItemHrid,
                        inspection.afterLevel
                    ),
                    slotKey: inspection.slotKey,
                    slotKeys: [inspection.slotKey],
                };
                confirmationByKey.set(key, request);
                confirmationRequests.push(request);
            }

            await Promise.all(confirmationRequests.map(async (request) => {
                if (request.confirmation) {
                    return;
                }
                request.confirmation = await marketHistoryService.getLatestAsk(
                    request.inspection.afterItemHrid,
                    request.inspection.afterLevel
                );
            }));

            const confirmations = confirmationRequests.map((request) => {
                if (!request.confirmation) {
                    return {
                        itemHrid: request.inspection.afterItemHrid,
                        enhancementLevel: request.inspection.afterLevel,
                        price: null,
                        volume: null,
                        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
                        marketTimestamp: 0,
                        slotKey: request.slotKey,
                        slotKeys: request.slotKeys,
                        manual: true,
                    };
                }
                return {
                    ...request.confirmation,
                    slotKey: request.slotKey,
                    slotKeys: request.slotKeys,
                };
            });
            return { requiresConfirmation: true, confirmations, refreshFailed };
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
                        settings: String(queuePlayerId) === normalizedPlayerId
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
            if (rankingSettingsChanged && queueState?.baseline) {
                const refreshedBaselineMetrics = resolveQueueBaselineMetricsForSettings(queueState.baseline, queueState.settings);
                if (isPlainObject(refreshedBaselineMetrics)) {
                    queueState.baseline.metrics = {
                        ...(isPlainObject(queueState.baseline.metrics) ? queueState.baseline.metrics : {}),
                        ...refreshedBaselineMetrics,
                    };
                }
            }
            if (rankingSettingsChanged && Array.isArray(queueState?.rawRuns) && queueState.rawRuns.length > 0) {
                this.refreshQueueResultsFromRawRuns({
                    playerId: normalizedPlayerId,
                    includeEmptyEntries: queueState?.isRunning !== true && queueState?.lastRunStatus === "completed",
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
            const normalizedItemId = String(itemId || "");
            if (queueState.isRunning || !queueState.items.some((item) => String(item?.id || "") === normalizedItemId)) {
                return false;
            }
            queueState.items = queueState.items.filter((item) => String(item?.id || "") !== normalizedItemId);
            queueState.rawRuns = queueState.rawRuns.filter((row) => String(row?.id || "") !== normalizedItemId);
            if (queueState.items.length === 0) {
                queueState.results = [];
                queueState.ranking = [];
                queueState.rawRuns = [];
                queueState.progress = 0;
                queueState.error = "";
                queueState.lastRunAt = 0;
                queueState.lastRunStatus = "idle";
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
            queueState.error = "";
            queueState.lastRunStatus = "idle";
        },
        loadQueueSnapshotToActivePlayer(snapshotId) {
            const queueState = this.ensureQueueState(this.activePlayerId);
            const activePlayerId = String(this.activePlayerId);
            const currentActive = this.players.find((player) => String(player.id) === activePlayerId);
            const currentSelected = currentActive?.selected ?? true;

            const normalizedSnapshotId = String(snapshotId || "").trim();
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
                return {
                    ...deepClone(targetSnapshot),
                    id: activePlayerId,
                    selected: currentSelected,
                };
            });
            this.persistPlayerAchievements();

            return true;
        },
        async refreshQueueResultsFromRawRuns(options = {}) {
            const playerId = String(options?.playerId || this.activePlayerId);
            const queueState = this.ensureQueueState(playerId);
            if (queueState.baseline?.snapshot) {
                for (const item of queueState.items) {
                    const inspections = inspectQueueEquipmentPricing(
                        queueState.baseline.snapshot,
                        item?.snapshot,
                        this.pricing,
                        item?.confirmedEquipmentPrices,
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
                allowReferenceLoad
                && queueEntriesNeedAbilityUpgradeReference(entries)
                && !hasAbilityUpgradeReferenceDataLoaded()
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
                    includeEmptyEntries: queueState?.isRunning !== true && queueState?.lastRunStatus === "completed",
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
