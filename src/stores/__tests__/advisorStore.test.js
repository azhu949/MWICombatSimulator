import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import actionDetailMap from "../../combatsimulator/data/actionDetailMap.json";

const ONE_HOUR = 60 * 60 * 1e9;

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: vi.fn((key, value) => {
            store.set(key, String(value));
        }),
        removeItem: vi.fn((key) => {
            store.delete(key);
        }),
        clear: vi.fn(() => {
            store.clear();
        }),
    };
}

vi.mock("../../services/profitEstimator.js", () => ({
    estimateNoRngProfit: (simResult) => ({
        revenue: Number(simResult?.mockProfit || 0),
        expenses: 0,
        profit: Number(simResult?.mockProfit || 0),
    }),
}));

vi.mock("../../services/workerClient.js", () => {
    const workerState = {
        multiCalls: [],
        singleCalls: [],
        failMultiTypes: new Set(),
        failSingleKeys: new Set(),
        zoneMetricResolver: null,
        labyrinthMetricResolver: null,
        singleMetricSequenceByKey: new Map(),
        failSingleRemainingByKey: new Map(),
        asyncSingleDelayMs: 0,
        activeSingleRuns: 0,
        maxConcurrentSingleRuns: 0,
        reset() {
            this.multiCalls = [];
            this.singleCalls = [];
            this.failMultiTypes = new Set();
            this.failSingleKeys = new Set();
            this.zoneMetricResolver = null;
            this.labyrinthMetricResolver = null;
            this.singleMetricSequenceByKey = new Map();
            this.failSingleRemainingByKey = new Map();
            this.asyncSingleDelayMs = 0;
            this.activeSingleRuns = 0;
            this.maxConcurrentSingleRuns = 0;
        },
    };

    function buildKey(payload) {
        if (payload?.zone) {
            return `${payload.zone.zoneHrid}#${payload.zone.difficultyTier}`;
        }
        if (payload?.labyrinth) {
            return `${payload.labyrinth.labyrinthHrid}#${payload.labyrinth.roomLevel}`;
        }
        return "unknown";
    }

    function defaultMetricFromZone(zone, index) {
        return {
            profitPerHour: 100 + index,
            xpPerHour: 50 + index,
            killsPerHour: 10 + index,
            deathsPerHour: Math.max(0.05, Number(zone?.difficultyTier || 0) * 0.25 + 0.1),
        };
    }

    function defaultMetricFromLabyrinth(labyrinth, index) {
        return {
            profitPerHour: 600 + index,
            xpPerHour: 40 + index,
            killsPerHour: 8 + index * 0.1,
            deathsPerHour: Math.max(0.01, Number(labyrinth?.roomLevel || 40) / 600),
        };
    }

    function createSimResult(payload, metric) {
        const xp = Number(metric?.xpPerHour || 0);
        const deathsPerHour = Number(metric?.deathsPerHour || 0);
        const killsPerHour = Number(metric?.killsPerHour || 0);
        return {
            simulatedTime: ONE_HOUR,
            isLabyrinth: Boolean(payload?.labyrinth),
            difficultyTier: Number(payload?.zone?.difficultyTier || 0),
            roomLevel: Number(payload?.labyrinth?.roomLevel || 0),
            zoneName: String(payload?.zone?.zoneHrid || ""),
            labyrinthName: String(payload?.labyrinth?.labyrinthHrid || ""),
            encounters: killsPerHour,
            numberOfPlayers: 1,
            experienceGained: {
                player1: {
                    attack: xp,
                },
            },
            deaths: {
                player1: deathsPerHour,
            },
            consumablesUsed: {
                player1: {},
            },
            manaUsed: {
                player1: 0,
            },
            dropRateMultiplier: {
                player1: 1,
            },
            rareFindMultiplier: {
                player1: 1,
            },
            combatDropQuantity: {
                player1: 0,
            },
            debuffOnLevelGap: {
                player1: 0,
            },
            mockProfit: Number(metric?.profitPerHour || 0),
        };
    }

    class FakeWorkerClient {
        startSimulation(payload, handlers = {}) {
            workerState.singleCalls.push(payload);
            const key = buildKey(payload);
            workerState.activeSingleRuns += 1;
            workerState.maxConcurrentSingleRuns = Math.max(workerState.maxConcurrentSingleRuns, workerState.activeSingleRuns);
            const finish = (callback) => {
                try {
                    callback();
                } finally {
                    workerState.activeSingleRuns = Math.max(0, workerState.activeSingleRuns - 1);
                }
            };
            const remainingFailures = Number(workerState.failSingleRemainingByKey.get(key) || 0);
            if (workerState.failSingleKeys.has(key) || remainingFailures > 0) {
                if (remainingFailures > 0) {
                    workerState.failSingleRemainingByKey.set(key, remainingFailures - 1);
                }
                const emitFailure = () => finish(() => handlers.onError?.(`forced single failure: ${key}`));
                if (workerState.asyncSingleDelayMs > 0) {
                    setTimeout(emitFailure, workerState.asyncSingleDelayMs);
                } else {
                    emitFailure();
                }
                return;
            }
            const queuedMetrics = workerState.singleMetricSequenceByKey.get(key);
            const nextMetric = Array.isArray(queuedMetrics) && queuedMetrics.length > 0
                ? queuedMetrics.shift()
                : (payload.zone
                    ? (workerState.zoneMetricResolver?.(payload.zone, workerState.singleCalls.length - 1, "single") || defaultMetricFromZone(payload.zone, workerState.singleCalls.length - 1))
                    : (workerState.labyrinthMetricResolver?.(payload.labyrinth, workerState.singleCalls.length - 1, "single") || defaultMetricFromLabyrinth(payload.labyrinth, workerState.singleCalls.length - 1)));
            const emitSuccess = () => finish(() => {
                handlers.onProgress?.({ progress: 1 });
                handlers.onResult?.(createSimResult(payload, nextMetric));
            });
            if (workerState.asyncSingleDelayMs > 0) {
                setTimeout(emitSuccess, workerState.asyncSingleDelayMs);
            } else {
                emitSuccess();
            }
        }

        startMultiSimulation(payload, handlers = {}) {
            workerState.multiCalls.push(payload);
            if (workerState.failMultiTypes.has(payload.type)) {
                handlers.onError?.(`forced multi failure: ${payload.type}`);
                return;
            }
            handlers.onProgress?.({ progress: 1 });
            if (payload.type === "start_simulation_all_zones") {
                const simResults = payload.zones.map((zone, index) => createSimResult({ zone }, workerState.zoneMetricResolver?.(zone, index, "multi") || defaultMetricFromZone(zone, index)));
                handlers.onBatchResult?.(simResults, "simulation_result_allZones");
                return;
            }
            const simResults = payload.labyrinths.map((labyrinth, index) => createSimResult({ labyrinth }, workerState.labyrinthMetricResolver?.(labyrinth, index, "multi") || defaultMetricFromLabyrinth(labyrinth, index)));
            handlers.onBatchResult?.(simResults, "simulation_result_allLabyrinths");
        }

        stopSimulation() {}
    }

    return {
        __esModule: true,
        default: new FakeWorkerClient(),
        WorkerClient: FakeWorkerClient,
        mockWorkerState: workerState,
    };
});

import { useSimulatorStore } from "../simulatorStore.js";
import { mockWorkerState } from "../../services/workerClient.js";

describe("advisor store", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        global.localStorage = createLocalStorageMock();
        mockWorkerState.reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function createStoreWithMocks() {
        const simulator = useSimulatorStore();
        simulator.players.forEach((player, index) => {
            player.selected = index === 0;
        });
        return { simulator, mockWorkerState };
    }

    it("runs advisor across zone and labyrinth targets and sorts the quick list", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            includeLabyrinths: true,
            refineTopEnabled: false,
        };
        simulator.advisor.goalPreset = "profit";
        mockWorkerState.zoneMetricResolver = (zone, index) => ({
            profitPerHour: 120 + index,
            xpPerHour: 80 + index,
            killsPerHour: 12 + index,
            deathsPerHour: 0.3 + Number(zone?.difficultyTier || 0) * 0.2,
        });
        mockWorkerState.labyrinthMetricResolver = (labyrinth, index) => ({
            profitPerHour: 1000 + index,
            xpPerHour: 60 + index,
            killsPerHour: 6 + index * 0.1,
            deathsPerHour: 0.08 + Number(labyrinth?.roomLevel || 40) / 1000,
        });

        const rows = await simulator.runAdvisorScan();
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((row) => row.targetType === "zone")).toBe(true);
        expect(rows.some((row) => row.targetType === "labyrinth")).toBe(true);
        expect(rows[0].targetType).toBe("labyrinth");
        expect(simulator.advisor.topCards.some((card) => card.key === "labyrinth")).toBe(true);
        expect(mockWorkerState.multiCalls.map((payload) => payload.type)).toEqual(expect.arrayContaining([
            "start_simulation_all_zones",
            "start_simulation_all_labyrinths",
        ]));
    });

    it("refines only the configured top rows in parallel by round", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.queueRuntime.parallelWorkerLimit = 3;
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            includeLabyrinths: false,
            refineTopEnabled: true,
            refineTopCount: 8,
            refineRounds: 2,
        };
        simulator.advisor.goalPreset = "balanced";
        mockWorkerState.asyncSingleDelayMs = 1;
        mockWorkerState.zoneMetricResolver = (zone, index) => ({
            profitPerHour: 200 + index,
            xpPerHour: 100 + index,
            killsPerHour: 20 + index,
            deathsPerHour: 0.1 + Number(zone?.difficultyTier || 0) * 0.1,
        });

        const rows = await simulator.runAdvisorScan();
        expect(rows.length).toBeGreaterThan(8);
        expect(mockWorkerState.singleCalls).toHaveLength(16);
        expect(mockWorkerState.maxConcurrentSingleRuns).toBeGreaterThan(1);
        const refinedRows = simulator.advisor.refinedRows.filter((row) => row.isRefined);
        expect(refinedRows).toHaveLength(8);
        expect(refinedRows.every((row) => row.successfulRounds === 2)).toBe(true);
    });

    it("keeps refining serial when parallel worker limit is 1", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.queueRuntime.parallelWorkerLimit = 1;
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            includeLabyrinths: false,
            refineTopEnabled: true,
            refineTopCount: 4,
            refineRounds: 2,
        };
        mockWorkerState.asyncSingleDelayMs = 1;
        mockWorkerState.zoneMetricResolver = (zone, index) => ({
            profitPerHour: 300 + index,
            xpPerHour: 150 + index,
            killsPerHour: 15 + index,
            deathsPerHour: 0.2 + Number(zone?.difficultyTier || 0) * 0.05,
        });

        await simulator.runAdvisorScan();
        expect(mockWorkerState.singleCalls).toHaveLength(8);
        expect(mockWorkerState.maxConcurrentSingleRuns).toBe(1);
        expect(simulator.advisor.refinedRows.filter((row) => row.isRefined)).toHaveLength(4);
    });

    it("keeps other refine targets running when one target fails every round", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.queueRuntime.parallelWorkerLimit = 4;
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            includeLabyrinths: false,
            refineTopEnabled: false,
            refineTopCount: 2,
            refineRounds: 2,
        };
        mockWorkerState.zoneMetricResolver = (zone, index) => ({
            profitPerHour: 500 + index,
            xpPerHour: 200 + index,
            killsPerHour: 25 + index,
            deathsPerHour: 0.05 + Number(zone?.difficultyTier || 0) * 0.05,
        });

        await simulator.runAdvisorScan();
        const targetToFail = simulator.advisor.quickRows[0];
        const survivingTarget = simulator.advisor.quickRows[1];

        mockWorkerState.singleCalls = [];
        mockWorkerState.maxConcurrentSingleRuns = 0;
        mockWorkerState.activeSingleRuns = 0;
        mockWorkerState.failSingleRemainingByKey.set(`${targetToFail.targetHrid}#${targetToFail.difficultyTier}`, 2);
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: true,
            refineTopCount: 2,
            refineRounds: 2,
        };

        await simulator.runAdvisorScan();
        const failedRow = simulator.advisor.refinedRows.find((row) => row.id === targetToFail.id);
        const survivorRow = simulator.advisor.refinedRows.find((row) => row.id === survivingTarget.id);
        expect(mockWorkerState.singleCalls).toHaveLength(4);
        expect(failedRow.isRefined).not.toBe(true);
        expect(failedRow.successfulRounds).toBe(1);
        expect(survivorRow.isRefined).toBe(true);
        expect(survivorRow.successfulRounds).toBe(2);
        expect(simulator.advisor.error).toContain('refine step');
    });

    it("applyAdvisorTarget backfills Home target without touching unrelated settings", async () => {
        const { simulator } = createStoreWithMocks();
        simulator.simulationSettings.mooPass = true;
        simulator.simulationSettings.comExpEnabled = true;
        simulator.simulationSettings.comExp = 55;
        simulator.pricing.dropMode = "ask";
        const validZone = Object.values(actionDetailMap).find((entry) => (
            String(entry?.type || "") === "/action_types/combat"
            && entry?.combatZoneInfo?.isDungeon !== true
            && Number(entry?.maxDifficulty || 0) >= 3
        ));

        const appliedZone = simulator.applyAdvisorTarget({
            targetType: "zone",
            targetHrid: validZone?.hrid || simulator.simulationSettings.zoneHrid,
            difficultyTier: 3,
        });
        expect(appliedZone).toBe(true);
        expect(simulator.simulationSettings.mode).toBe("zone");
        expect(simulator.simulationSettings.runScope).toBe("single");
        expect(simulator.simulationSettings.zoneHrid).toBe(validZone?.hrid || simulator.simulationSettings.zoneHrid);
        expect(simulator.simulationSettings.difficultyTier).toBe(3);
        expect(simulator.simulationSettings.mooPass).toBe(true);
        expect(simulator.pricing.dropMode).toBe("ask");

        const appliedLabyrinth = simulator.applyAdvisorTarget({
            targetType: "labyrinth",
            targetHrid: "/combat_monsters/gobo_guardian",
            roomLevel: 140,
        });
        expect(appliedLabyrinth).toBe(true);
        expect(simulator.simulationSettings.mode).toBe("labyrinth");
        expect(simulator.simulationSettings.labyrinthHrid).toBe("/combat_monsters/gobo_guardian");
        expect(simulator.simulationSettings.roomLevel).toBe(140);
        expect(simulator.simulationSettings.mooPass).toBe(true);
        expect(simulator.pricing.dropMode).toBe("ask");
    });
});
