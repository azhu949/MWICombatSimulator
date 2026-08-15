import {
    ADVISOR_GOAL_PRESET_BALANCED,
    normalizeAdvisorGoalPreset,
    normalizeAdvisorWeights,
} from "./advisorScoring.js";
import {
    buildAdvisorCandidates,
    buildAdvisorPartialErrorText,
    buildAdvisorRowFromRoundMetrics,
    createAdvisorSimulationPayload,
    normalizeAdvisorFilters,
    resolveAdvisorMetricPlayer,
    summarizeAdvisorTargetResult,
} from "./advisorDomain.js";
import {
    ONE_HOUR,
    buildSimulationExtra,
} from "./simulationDomain.js";
import { normalizeParallelWorkerLimit } from "./queueScoring.js";
import {
    DEDICATED_WORKER_SCOPE_ADVISOR,
    createWorkerRunCancellationError,
    isWorkerRunCancelledError,
    runMultiSimulationPayloadWithDedicatedWorker,
    runSingleSimulationPayloadWithDedicatedWorker,
} from "./simulatorWorkerRuns.js";
import { createProfitPricingOptions } from "./simulatorStorage.js";
import { clamp } from "./utils.js";

const ADVISOR_ERROR_ANOTHER_RUN = "Another simulation is already running.";
const ADVISOR_ERROR_NO_PLAYERS = "Please select at least one player.";
const ADVISOR_ERROR_NO_SIMULATION_PLAYERS = "Unable to build player simulation data.";
const ADVISOR_ERROR_NO_TARGETS = "No advisor targets available for the current filters.";

function createAdvisorScanContext({
    store,
    selectedPlayersSnapshot,
    playersToSim,
    normalizedFilters,
    normalizedGoalPreset,
    normalizedCustomWeights,
    candidates,
    metricPlayer,
    pricingOptions,
    simulationTimeLimit,
    extra,
    refineTopCount,
    startedAt,
    runId,
}) {
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
    const getAdvisorRowsForReturn = () => (
        Array.isArray(store.advisor.refinedRows) && store.advisor.refinedRows.length > 0
            ? store.advisor.refinedRows
            : store.advisor.quickRows
    );
    const ensureActiveAdvisorRun = () => {
        if (!isActiveAdvisorRun()) {
            throw createWorkerRunCancellationError("Advisor scan cancelled.");
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
            quickRows: Array.from(quickRowsById.values()),
            refinedRows: [],
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
            quickRows: store.advisor.quickRows,
            refinedRows: mergedRows,
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
            pricingOptions
        );
        samples.push(sample);
        quickSamplesById.set(candidate.id, samples);
        quickRowsById.set(candidate.id, buildAdvisorRowFromRoundMetrics(candidate, samples, {
            isRefined: false,
            refineRounds: 0,
        }));
        quickCompleted += 1;
        updateAdvisorRuntime("quick_scan", 0, 0);
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
                    updateAdvisorRuntime("quick_scan", inFlightWorkUnits, 0);
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
                }
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
                            updateAdvisorRuntime("quick_scan", clamp(Number(data?.progress || 0), 0, 1), 0);
                        },
                        { scope: DEDICATED_WORKER_SCOPE_ADVISOR }
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
                        updateAdvisorRuntime("quick_scan", 0, 0);
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
    context.updateAdvisorRuntime("quick_scan", 0, 0);
    for (
        let quickRoundIndex = 0;
        quickRoundIndex < context.normalizedFilters.quickRounds;
        quickRoundIndex += 1
    ) {
        const roundCandidates = quickRoundIndex === 0
            ? context.candidates
            : context.candidates.filter((candidate) => context.quickRowsById.has(candidate.id));
        if (roundCandidates.length === 0) {
            break;
        }
        if (quickRoundIndex === 1 && roundCandidates.length < context.candidates.length) {
            const surviving = roundCandidates.length;
            context.quickRoundsTotal = context.candidates.length
                + surviving * (context.normalizedFilters.quickRounds - 1);
            context.totalWorkUnits = Math.max(1, context.quickRoundsTotal + context.refineTotal);
        }
        await context.collectQuickRows(
            roundCandidates,
            () => ({
                type: "start_simulation_all_zones",
                players: context.playersToSim,
                zones: roundCandidates.map((candidate) => ({
                    zoneHrid: candidate.targetHrid,
                    difficultyTier: candidate.difficultyTier,
                })),
                simulationTimeLimit: context.simulationTimeLimit,
                extra: context.extra,
            }),
            "quick scan",
            quickRoundIndex
        );
        context.ensureActiveAdvisorRun();
    }

    if (context.quickRowsById.size === 0) {
        throw new Error(
            context.errorMessages[0] || "Advisor scan did not produce any successful result."
        );
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
    context.updateAdvisorRuntime("refine_top", 0, 0);
    const roundMetricsById = new Map(quickRowsForRefine.map((row) => [row.id, []]));
    const refineParallelWorkerLimit = Math.max(
        1,
        Math.min(
            normalizeParallelWorkerLimit(
                store.queueRuntime?.parallelWorkerLimit,
                store.queueParallelWorkerHardMax
            ),
            quickRowsForRefine.length
        )
    );

    const runRefineRoundForRow = async (row) => {
        try {
            const simResult = await runSingleSimulationPayloadWithDedicatedWorker(
                createAdvisorSimulationPayload(
                    row,
                    context.playersToSim,
                    context.simulationTimeLimit,
                    context.extra
                ),
                () => {},
                { scope: DEDICATED_WORKER_SCOPE_ADVISOR }
            );
            context.ensureActiveAdvisorRun();
            const roundMetrics = roundMetricsById.get(row.id) || [];
            roundMetrics.push(summarizeAdvisorTargetResult(
                simResult,
                context.selectedPlayersSnapshot,
                context.metricPlayer.id,
                context.pricingOptions
            ));
            roundMetricsById.set(row.id, roundMetrics);
            if (roundMetrics.length >= context.normalizedFilters.refineRounds) {
                context.refinedRowsById.set(row.id, buildAdvisorRowFromRoundMetrics(row, roundMetrics, {
                    isRefined: true,
                    refineRounds: context.normalizedFilters.refineRounds,
                }));
                context.rerankLiveRefinedRows();
            }
        } catch (error) {
            if (isWorkerRunCancelledError(error)) {
                throw error;
            }
        } finally {
            context.incrementRefineCompleted();
            context.updateAdvisorRuntime("refine_top", 0, 0);
        }
    };

    for (
        let roundIndex = 0;
        roundIndex < context.normalizedFilters.refineRounds;
        roundIndex += 1
    ) {
        if (refineParallelWorkerLimit > 1 && quickRowsForRefine.length > 1) {
            let nextRowIndex = 0;
            const workerLoop = async () => {
                while (nextRowIndex < quickRowsForRefine.length) {
                    const currentRowIndex = nextRowIndex;
                    nextRowIndex += 1;
                    const row = quickRowsForRefine[currentRowIndex];
                    await runRefineRoundForRow(row);
                }
            };
            await Promise.all(Array.from({ length: refineParallelWorkerLimit }, () => workerLoop()));
            continue;
        }

        for (const row of quickRowsForRefine) {
            await runRefineRoundForRow(row);
        }
    }

    const refinedFailures = quickRowsForRefine.filter((row) => !context.refinedRowsById.has(row.id));
    const refinePartialError = buildAdvisorPartialErrorText("refine step", refinedFailures);
    if (refinePartialError) {
        context.errorMessages.push(refinePartialError);
    }
    context.ensureActiveAdvisorRun();
    context.rerankLiveRefinedRows();
}

function completeAdvisorScan(context, store) {
    context.ensureActiveAdvisorRun();
    store.advisor.error = context.errorMessages.join(" ").trim();
    store.advisor.runtime.isRunning = false;
    store.advisor.runtime.phase = "done";
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
        store.advisor.error = "";
        store.advisor.runtime.isRunning = false;
        store.advisor.runtime.phase = "cancelled";
        store.advisor.runtime.elapsedSeconds = (Date.now() - context.startedAt) / 1000;
        store.advisor.runtime.quickCompleted = context.quickCompleted;
        store.advisor.runtime.quickTotal = context.quickRoundsTotal;
        store.advisor.runtime.refineCompleted = context.refineCompleted;
        store.advisor.runtime.refineTotal = context.refineTotal;
        return context.getAdvisorRowsForReturn();
    }

    store.advisor.error = typeof error === "string"
        ? error
        : (error?.message || JSON.stringify(error));
    store.advisor.runtime.isRunning = false;
    store.advisor.runtime.phase = "idle";
    store.advisor.runtime.progress = 0;
    store.advisor.runtime.elapsedSeconds = (Date.now() - context.startedAt) / 1000;
    store.advisor.runtime.cancelRequested = false;
    return [];
}

export async function executeAdvisorScan({ store, loadPlayerMapperModule }) {
    store.advisor.error = "";
    if (store.runtime.isRunning || store.isAnyQueueRunning || store.advisor.runtime?.isRunning) {
        store.advisor.error = ADVISOR_ERROR_ANOTHER_RUN;
        return [];
    }

    const selectedPlayersSnapshot = store.selectedPlayers.map((player) => ({ id: player.id, name: player.name }));
    if (selectedPlayersSnapshot.length === 0) {
        store.advisor.error = ADVISOR_ERROR_NO_PLAYERS;
        return [];
    }

    const { buildPlayersForSimulation } = await loadPlayerMapperModule();
    const playersToSim = buildPlayersForSimulation(store.players);
    if (playersToSim.length === 0) {
        store.advisor.error = ADVISOR_ERROR_NO_SIMULATION_PLAYERS;
        return [];
    }

    const normalizedFilters = normalizeAdvisorFilters(store.advisor.filters);
    const normalizedGoalPreset = normalizeAdvisorGoalPreset(store.advisor.goalPreset);
    const normalizedCustomWeights = normalizeAdvisorWeights(
        store.advisor.customWeights,
        ADVISOR_GOAL_PRESET_BALANCED
    );
    const candidates = buildAdvisorCandidates(normalizedFilters);
    const metricPlayer = resolveAdvisorMetricPlayer(selectedPlayersSnapshot, store.activePlayerId);

    store.advisor.filters = normalizedFilters;
    store.advisor.goalPreset = normalizedGoalPreset;
    store.advisor.customWeights = normalizedCustomWeights;
    store.advisor.quickRows = [];
    store.advisor.refinedRows = [];
    store.advisor.topCards = [];
    store.advisor.metricPlayerId = metricPlayer.id;
    store.advisor.metricPlayerName = metricPlayer.name;

    if (candidates.length === 0) {
        store.advisor.error = ADVISOR_ERROR_NO_TARGETS;
        return [];
    }

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
    const context = createAdvisorScanContext({
        store,
        selectedPlayersSnapshot,
        playersToSim,
        normalizedFilters,
        normalizedGoalPreset,
        normalizedCustomWeights,
        candidates,
        metricPlayer,
        pricingOptions,
        simulationTimeLimit,
        extra,
        refineTopCount,
        startedAt,
        runId,
    });

    try {
        await runAdvisorQuickPhase(context);
        await runAdvisorRefinePhase(context, store);
        return completeAdvisorScan(context, store);
    } catch (error) {
        return handleAdvisorScanError(error, context, store);
    }
}
