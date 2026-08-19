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
} from "../services/simulationDomain.js";
import { normalizeParallelWorkerLimit } from "../services/queueScoring.js";
import {
    createProfitPricingOptions,
    persistSimulationUiSettingsToStorage,
} from "../services/simulatorStorage.js";
import {
    cancelSharedWorkerRun,
    hasSharedWorkerRunInProgress,
    runSharedSingleSimulationPayload,
    runSingleSimulationPayloadWithDedicatedWorker,
    stopQueueWorkerClients,
} from "../services/simulatorWorkerRuns.js";
import { clamp, toFiniteNumber } from "../services/utils.js";

export function createSimulationActions({ loadPlayerMapperModule, workerClient }) {
    return {
        buildSingleSimulationPayload(playersToSim, options = {}) {
            const payloadOptions = options && typeof options === "object" && !Array.isArray(options)
                ? options
                : {};
            const simulationSettings = payloadOptions.simulationSettings || this.simulationSettings;
            if (!payloadOptions.simulationSettings) {
                this.normalizeDifficulty();
            }
            return buildSimulationPayload(
                playersToSim,
                simulationSettings,
                payloadOptions.activeLabyrinthCrates ?? this.getActiveLabyrinthCrates(),
                payloadOptions
            );
        },
        runSingleSimulationPayload(payload, onProgress = () => {}, options = {}) {
            return runSharedSingleSimulationPayload(payload, onProgress, options);
        },
        runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
            return runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress, options);
        },
        setSimulationMode(mode) {
            this.simulationSettings.mode = mode === "labyrinth" ? "labyrinth" : "zone";
            this.normalizeRunScope();
            this.normalizeDifficulty();
        },
        setRunScope(scope) {
            this.simulationSettings.runScope = String(scope || RUN_SCOPE_SINGLE);
            this.normalizeRunScope();
        },
        normalizeBatchSelections() {
            const groupHrids = this.groupZoneOptions.map((zone) => String(zone.hrid || ""));
            const soloHrids = this.soloZoneOptions.map((zone) => String(zone.hrid || ""));
            this.simulationSettings.selectedGroupZoneHrids = normalizeZoneSelection(
                this.simulationSettings.selectedGroupZoneHrids,
                groupHrids
            );
            this.simulationSettings.selectedSoloZoneHrids = normalizeZoneSelection(
                this.simulationSettings.selectedSoloZoneHrids,
                soloHrids
            );
            this.simulationSettings.labyrinthCrates = normalizeLabyrinthCrates(this.simulationSettings.labyrinthCrates);
        },
        setSelectedGroupZoneHrids(hrids = []) {
            const allHrids = this.groupZoneOptions.map((zone) => String(zone.hrid || ""));
            this.simulationSettings.selectedGroupZoneHrids = normalizeZoneSelection(hrids, allHrids);
        },
        setSelectedSoloZoneHrids(hrids = []) {
            const allHrids = this.soloZoneOptions.map((zone) => String(zone.hrid || ""));
            this.simulationSettings.selectedSoloZoneHrids = normalizeZoneSelection(hrids, allHrids);
        },
        toggleSelectedGroupZoneHrid(zoneHrid, checked) {
            const hrid = String(zoneHrid || "");
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
            const hrid = String(zoneHrid || "");
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
        getActiveLabyrinthCrates() {
            const crates = this.simulationSettings.labyrinthCrates || {};
            const values = [String(crates.coffee || ""), String(crates.food || ""), String(crates.tea || "")].filter(Boolean);
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

            if (this.simulationSettings.mode === "labyrinth") {
                if (scope !== RUN_SCOPE_SINGLE && scope !== RUN_SCOPE_ALL_LABYRINTHS) {
                    this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
                }
                this.simulationSettings.useDungeon = false;
                return;
            }

            if (
                scope !== RUN_SCOPE_SINGLE
                && scope !== RUN_SCOPE_ALL_GROUP_ZONES
                && scope !== RUN_SCOPE_ALL_SOLO_ZONES
            ) {
                this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
            }

            if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
                this.simulationSettings.useDungeon = false;
            }
        },
        normalizeDifficulty() {
            const maxDifficulty = Math.min(5, this.currentMaxDifficulty);
            this.simulationSettings.difficultyTier = clamp(Number(this.simulationSettings.difficultyTier || 0), 0, maxDifficulty);
        },
        resetResultsForRun() {
            this.results.simResult = null;
            this.results.simResults = [];
            this.results.summaryRows = [];
            this.results.batchRows = [];
            this.results.batchResultType = "";
            this.results.timeSeriesData = null;
            this.syncActiveResultPlayerToActivePlayer(this.activePlayerId);
        },
        stopSimulation() {
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
            if (manualRunInProgress) {
                this.runtime.isRunning = false;
                this.runtime.progress = 0;
                this.runtime.startedAt = 0;
                this.runtime.elapsedSeconds = 0;
                this.runtime.workerMode = "single";
            }
            if (advisorRunInProgress) {
                this.stopAdvisorScan();
            }
        },
        async startSimulation() {
            this.runtime.error = "";
            this.normalizeRunScope();

            if (this.isAnyQueueRunning) {
                this.runtime.error = "common:simulation.errorQueueInProgress";
                return;
            }

            if (this.advisor.runtime?.isRunning) {
                this.runtime.error = "common:simulation.errorAdvisorInProgress";
                return;
            }

            if (hasSharedWorkerRunInProgress()) {
                this.runtime.error = "common:simulation.errorAnotherRunInProgress";
                return;
            }

            const selectedPlayersSnapshot = this.selectedPlayers.map((player) => ({ id: player.id, name: player.name }));

            if (selectedPlayersSnapshot.length === 0) {
                this.runtime.error = "common:simulation.errorNoPlayer";
                return;
            }

            const { buildPlayersForSimulation } = await loadPlayerMapperModule();
            const playersToSim = buildPlayersForSimulation(this.players);
            if (playersToSim.length === 0) {
                this.runtime.error = "common:simulation.errorBuildPlayerData";
                return;
            }

            this.normalizeDifficulty();

            const simulationTimeHours = Math.max(1, Number(this.simulationSettings.simulationTimeHours || 24));
            const simulationTimeLimit = simulationTimeHours * ONE_HOUR;
            const extra = buildSimulationExtra(this.simulationSettings);
            const runScope = this.simulationSettings.runScope;
            const parallelWorkerLimit = normalizeParallelWorkerLimit(
                this.queueRuntime?.parallelWorkerLimit,
                this.queueParallelWorkerHardMax
            );
            const pricingOptions = createProfitPricingOptions(this.pricing);
            const startedAt = Date.now();

            // Re-check after the await above: a shared run may have started in the meantime.
            if (hasSharedWorkerRunInProgress()) {
                this.runtime.error = "common:simulation.errorAnotherRunInProgress";
                return;
            }

            this.runtime.isRunning = true;
            this.runtime.progress = 0;
            this.runtime.startedAt = startedAt;
            this.runtime.elapsedSeconds = 0;
            this.runtime.workerMode = runScope === RUN_SCOPE_SINGLE ? "single" : "multi";
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
                this.runtime.error = typeof error === "string" ? error : JSON.stringify(error);
            };

            if (runScope === RUN_SCOPE_SINGLE) {
                workerClient.startSimulation(
                    this.buildSingleSimulationPayload(playersToSim),
                    {
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
                    }
                );

                return;
            }

            if (runScope === RUN_SCOPE_ALL_LABYRINTHS) {
                const labyrinths = buildAllLabyrinthTargets(this.getActiveLabyrinthCrates());
                if (labyrinths.length === 0) {
                    this.runtime.isRunning = false;
                    this.runtime.error = "common:simulation.errorNoLabyrinthTargets";
                    return;
                }

                workerClient.startMultiSimulation(
                    {
                        type: "start_simulation_all_labyrinths",
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
                            this.results.batchResultType = batchResultType || "simulation_result_allLabyrinths";
                            this.runtime.completionNoticeId += 1;
                        },
                        onError,
                    }
                );

                return;
            }

            const selectedZoneHrids = runScope === RUN_SCOPE_ALL_GROUP_ZONES
                ? this.simulationSettings.selectedGroupZoneHrids
                : this.simulationSettings.selectedSoloZoneHrids;
            const zones = buildZoneTargetsByScope(runScope, selectedZoneHrids);
            if (zones.length === 0) {
                this.runtime.isRunning = false;
                this.runtime.error = "common:simulation.errorNoZoneTargets";
                return;
            }

            workerClient.startMultiSimulation(
                {
                    type: "start_simulation_all_zones",
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
                        this.results.batchResultType = batchResultType || "simulation_result_allZones";
                        this.runtime.completionNoticeId += 1;
                    },
                    onError,
                }
            );
        },
    };
}
