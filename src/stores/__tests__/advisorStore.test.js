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
    estimateNoRngProfit: (simResult, playerHrid) => ({
        revenue: Number(simResult?.mockProfitByPlayer?.[playerHrid] ?? simResult?.mockProfit ?? 0),
        expenses: 0,
        profit: Number(simResult?.mockProfitByPlayer?.[playerHrid] ?? simResult?.mockProfit ?? 0),
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
        asyncMultiItemDelayMs: 0,
        asyncMultiBatchDelayMs: 0,
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
            this.asyncMultiItemDelayMs = 0;
            this.asyncMultiBatchDelayMs = 0;
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

    function resolvePlayerMetric(metric, playerHrid) {
        const defaultMetric = {
            profitPerHour: Number(metric?.profitPerHour || 0),
            xpPerHour: Number(metric?.xpPerHour || 0),
            deathsPerHour: Number(metric?.deathsPerHour || 0),
        };
        const scopedMetric = metric?.playerMetrics?.[playerHrid];
        return {
            ...defaultMetric,
            ...(scopedMetric && typeof scopedMetric === "object" ? scopedMetric : {}),
        };
    }

    function createSimResult(payload, metric) {
        const killsPerHour = Number(metric?.killsPerHour || 0);
        const players = Array.isArray(payload?.players) && payload.players.length > 0
            ? payload.players
            : [{ hrid: "player1" }];
        const experienceGained = {};
        const deaths = {};
        const consumablesUsed = {};
        const manaUsed = {};
        const dropRateMultiplier = {};
        const rareFindMultiplier = {};
        const combatDropQuantity = {};
        const debuffOnLevelGap = {};
        const mockProfitByPlayer = {};

        players.forEach((player, index) => {
            const playerHrid = String(player?.hrid || `player${index + 1}`);
            const playerMetric = resolvePlayerMetric(metric, playerHrid);
            experienceGained[playerHrid] = {
                attack: Number(playerMetric?.xpPerHour || 0),
            };
            deaths[playerHrid] = Number(playerMetric?.deathsPerHour || 0);
            consumablesUsed[playerHrid] = {};
            manaUsed[playerHrid] = 0;
            dropRateMultiplier[playerHrid] = 1;
            rareFindMultiplier[playerHrid] = 1;
            combatDropQuantity[playerHrid] = 0;
            debuffOnLevelGap[playerHrid] = 0;
            mockProfitByPlayer[playerHrid] = Number(playerMetric?.profitPerHour || 0);
        });

        return {
            simulatedTime: ONE_HOUR,
            isLabyrinth: Boolean(payload?.labyrinth),
            difficultyTier: Number(payload?.zone?.difficultyTier || 0),
            roomLevel: Number(payload?.labyrinth?.roomLevel || 0),
            zoneName: String(payload?.zone?.zoneHrid || ""),
            labyrinthName: String(payload?.labyrinth?.labyrinthHrid || ""),
            encounters: killsPerHour,
            numberOfPlayers: players.length,
            experienceGained,
            deaths,
            consumablesUsed,
            manaUsed,
            dropRateMultiplier,
            rareFindMultiplier,
            combatDropQuantity,
            debuffOnLevelGap,
            mockProfit: Number(metric?.profitPerHour || 0),
            mockProfitByPlayer,
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
            const isZonePayload = payload.type === "start_simulation_all_zones";
            const targets = isZonePayload ? payload.zones : payload.labyrinths;
            const batchResultType = isZonePayload ? "simulation_result_allZones" : "simulation_result_allLabyrinths";
            const simResults = targets.map((target, index) => (
                isZonePayload
                    ? createSimResult(
                        { zone: target, players: payload.players },
                        workerState.zoneMetricResolver?.(target, index, "multi") || defaultMetricFromZone(target, index)
                    )
                    : createSimResult(
                        { labyrinth: target, players: payload.players },
                        workerState.labyrinthMetricResolver?.(target, index, "multi") || defaultMetricFromLabyrinth(target, index)
                    )
            ));
            const emitItemResult = (target, index) => {
                handlers.onProgress?.({ progress: (index + 1) / Math.max(1, targets.length) });
                handlers.onItemResult?.(isZonePayload
                    ? {
                        index,
                        zone: target,
                        zoneHrid: target.zoneHrid,
                        difficultyTier: target.difficultyTier,
                        simResult: simResults[index],
                    }
                    : {
                        index,
                        labyrinth: target,
                        labyrinthHrid: target.labyrinthHrid,
                        roomLevel: target.roomLevel,
                        simResult: simResults[index],
                    });
            };
            const emitBatchResult = () => {
                handlers.onProgress?.({ progress: 1 });
                handlers.onBatchResult?.(simResults, batchResultType);
            };

            if (workerState.asyncMultiItemDelayMs > 0 || workerState.asyncMultiBatchDelayMs > 0) {
                targets.forEach((target, index) => {
                    const delayMs = workerState.asyncMultiItemDelayMs * (index + 1);
                    setTimeout(() => emitItemResult(target, index), delayMs);
                });
                const batchDelayMs = Math.max(
                    workerState.asyncMultiBatchDelayMs,
                    workerState.asyncMultiItemDelayMs * Math.max(1, targets.length)
                );
                setTimeout(() => emitBatchResult(), batchDelayMs);
                return;
            }

            targets.forEach((target, index) => emitItemResult(target, index));
            emitBatchResult();
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

function waitForMs(delayMs) {
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}

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

    it("runs advisor across zone targets only and sorts the quick list", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: false,
        };
        simulator.advisor.goalPreset = "profit";
        mockWorkerState.zoneMetricResolver = (zone, index) => ({
            profitPerHour: 120 + index,
            xpPerHour: 80 + index,
            killsPerHour: 12 + index,
            deathsPerHour: 0.3 + Number(zone?.difficultyTier || 0) * 0.2,
        });

        const rows = await simulator.runAdvisorScan();
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((row) => row.targetType === "zone")).toBe(true);
        expect(rows.some((row) => row.targetType === "labyrinth")).toBe(false);
        expect(simulator.advisor.filters).not.toHaveProperty("includeLabyrinths");
        expect(simulator.advisor.topCards.some((card) => card.key === "labyrinth")).toBe(false);
        expect(mockWorkerState.multiCalls.map((payload) => payload.type)).toEqual(["start_simulation_all_zones"]);
    });

    it("uses the active player metrics instead of summing selected party members", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.players[1].selected = true;
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: false,
        };
        mockWorkerState.zoneMetricResolver = () => ({
            profitPerHour: 0,
            xpPerHour: 0,
            killsPerHour: 14,
            deathsPerHour: 0,
            playerMetrics: {
                player1: {
                    profitPerHour: 111,
                    xpPerHour: 222,
                    deathsPerHour: 0.25,
                },
                player2: {
                    profitPerHour: 999,
                    xpPerHour: 888,
                    deathsPerHour: 3.5,
                },
            },
        });

        const rows = await simulator.runAdvisorScan();

        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].profitPerHour).toBe(111);
        expect(rows[0].xpPerHour).toBe(222);
        expect(rows[0].deathsPerHour).toBe(0.25);
        expect(simulator.advisor.metricPlayerId).toBe("1");
        expect(simulator.advisor.metricPlayerName).toBe("Player 1");
    });

    it("ranks advisor targets by the active player metrics rather than party totals", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.players[1].selected = true;
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: false,
        };
        simulator.advisor.goalPreset = "profit";
        mockWorkerState.zoneMetricResolver = (_zone, index) => {
            if (index === 0) {
                return {
                    profitPerHour: 0,
                    xpPerHour: 0,
                    killsPerHour: 10,
                    deathsPerHour: 0.1,
                    playerMetrics: {
                        player1: { profitPerHour: 50, xpPerHour: 50, deathsPerHour: 0.1 },
                        player2: { profitPerHour: 500, xpPerHour: 500, deathsPerHour: 0.1 },
                    },
                };
            }
            if (index === 1) {
                return {
                    profitPerHour: 0,
                    xpPerHour: 0,
                    killsPerHour: 11,
                    deathsPerHour: 0.1,
                    playerMetrics: {
                        player1: { profitPerHour: 400, xpPerHour: 400, deathsPerHour: 0.1 },
                        player2: { profitPerHour: 0, xpPerHour: 0, deathsPerHour: 0.1 },
                    },
                };
            }
            return {
                profitPerHour: 0,
                xpPerHour: 0,
                killsPerHour: 5,
                deathsPerHour: 0.2,
                playerMetrics: {
                    player1: { profitPerHour: 10, xpPerHour: 10, deathsPerHour: 0.2 },
                    player2: { profitPerHour: 10, xpPerHour: 10, deathsPerHour: 0.2 },
                },
            };
        };

        const rows = await simulator.runAdvisorScan();
        const zonePayload = mockWorkerState.multiCalls.find((payload) => payload.type === "start_simulation_all_zones");
        const expectedTopZone = zonePayload?.zones?.[1];

        expect(rows[0].profitPerHour).toBe(400);
        expect(rows[0].targetHrid).toBe(expectedTopZone?.zoneHrid);
        expect(rows[0].difficultyTier).toBe(expectedTopZone?.difficultyTier);
    });

    it("falls back to the first selected player when the active player is not selected", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.players[1].selected = false;
        simulator.players[2].selected = true;
        simulator.setActivePlayer("2");
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: false,
        };
        mockWorkerState.zoneMetricResolver = () => ({
            profitPerHour: 0,
            xpPerHour: 0,
            killsPerHour: 9,
            deathsPerHour: 0,
            playerMetrics: {
                player1: {
                    profitPerHour: 123,
                    xpPerHour: 456,
                    deathsPerHour: 0.5,
                },
                player3: {
                    profitPerHour: 789,
                    xpPerHour: 999,
                    deathsPerHour: 1.5,
                },
            },
        });

        const rows = await simulator.runAdvisorScan();

        expect(simulator.resolvedAdvisorMetricPlayer.id).toBe("1");
        expect(simulator.resolvedAdvisorMetricPlayer.name).toBe("Player 1");
        expect(simulator.advisor.metricPlayerId).toBe("1");
        expect(simulator.advisor.metricPlayerName).toBe("Player 1");
        expect(rows[0].profitPerHour).toBe(123);
        expect(rows[0].xpPerHour).toBe(456);
        expect(rows[0].deathsPerHour).toBe(0.5);
    });

    it("refines only the configured top rows in parallel by round", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.queueRuntime.parallelWorkerLimit = 3;
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
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

    it("streams quick scan rows before the batch run finishes", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: false,
        };
        simulator.advisor.goalPreset = "profit";
        mockWorkerState.asyncMultiItemDelayMs = 3;
        mockWorkerState.asyncMultiBatchDelayMs = 40;
        mockWorkerState.zoneMetricResolver = (zone, index) => ({
            profitPerHour: 900 - index,
            xpPerHour: 400 + index,
            killsPerHour: 30 + index,
            deathsPerHour: 0.05 + Number(zone?.difficultyTier || 0) * 0.02,
        });

        const runPromise = simulator.runAdvisorScan();
        await waitForMs(10);

        const zonePayload = mockWorkerState.multiCalls.find((payload) => payload.type === "start_simulation_all_zones");
        expect(zonePayload?.zones?.length).toBeGreaterThan(3);
        expect(simulator.advisor.runtime.isRunning).toBe(true);
        expect(simulator.advisor.quickRows.length).toBeGreaterThan(0);
        expect(simulator.advisor.quickRows.length).toBeLessThan(zonePayload.zones.length);
        expect(simulator.advisor.topCards.length).toBeGreaterThan(0);

        const rows = await runPromise;
        expect(rows).toHaveLength(zonePayload.zones.length);
    });

    it("keeps refining serial when parallel worker limit is 1", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.queueRuntime.parallelWorkerLimit = 1;
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
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

    it("stops advisor scans without clearing partial results", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: false,
        };
        mockWorkerState.asyncMultiItemDelayMs = 3;
        mockWorkerState.asyncMultiBatchDelayMs = 40;
        mockWorkerState.zoneMetricResolver = (zone, index) => ({
            profitPerHour: 700 - index,
            xpPerHour: 300 + index,
            killsPerHour: 18 + index,
            deathsPerHour: 0.1 + Number(zone?.difficultyTier || 0) * 0.02,
        });

        const runPromise = simulator.runAdvisorScan();
        await waitForMs(10);

        const partialRowsBeforeStop = simulator.advisor.quickRows.length;
        expect(partialRowsBeforeStop).toBeGreaterThan(0);
        expect(simulator.stopAdvisorScan()).toBe(true);

        const rows = await runPromise;
        expect(rows).toHaveLength(partialRowsBeforeStop);
        expect(simulator.advisor.quickRows).toHaveLength(partialRowsBeforeStop);
        expect(simulator.advisor.runtime.isRunning).toBe(false);
        expect(simulator.advisor.runtime.phase).toBe("cancelled");
        expect(simulator.advisor.error).toBe("");
    });

    it("surfaces streaming callback failures as advisor errors", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: false,
        };
        mockWorkerState.asyncMultiItemDelayMs = 2;
        mockWorkerState.asyncMultiBatchDelayMs = 20;

        simulator.rerankAdvisorResults = vi.fn(() => {
            throw new Error("forced rerank failure");
        });

        const rows = await simulator.runAdvisorScan();

        expect(rows).toEqual([]);
        expect(simulator.advisor.error).toBe("forced rerank failure");
        expect(simulator.advisor.runtime.isRunning).toBe(false);
        expect(simulator.advisor.runtime.phase).toBe("idle");
    });

    it("ignores late callbacks from a cancelled run after a new run starts", async () => {
        const { simulator, mockWorkerState } = createStoreWithMocks();
        simulator.advisor.filters = {
            ...simulator.advisor.filters,
            refineTopEnabled: false,
        };
        simulator.advisor.goalPreset = "profit";
        mockWorkerState.asyncMultiItemDelayMs = 3;
        mockWorkerState.asyncMultiBatchDelayMs = 40;
        mockWorkerState.zoneMetricResolver = (_zone, index) => ({
            profitPerHour: 100 + index,
            xpPerHour: 50 + index,
            killsPerHour: 10 + index,
            deathsPerHour: 0.2,
        });

        const cancelledRunPromise = simulator.runAdvisorScan();
        await waitForMs(10);
        expect(simulator.advisor.quickRows.length).toBeGreaterThan(0);
        simulator.stopAdvisorScan();
        await cancelledRunPromise;

        mockWorkerState.asyncMultiItemDelayMs = 1;
        mockWorkerState.asyncMultiBatchDelayMs = 10;
        mockWorkerState.zoneMetricResolver = (_zone, index) => ({
            profitPerHour: 5000 - index,
            xpPerHour: 1200 + index,
            killsPerHour: 60 + index,
            deathsPerHour: 0.01,
        });

        const rerunRows = await simulator.runAdvisorScan();
        const topProfitAfterRerun = rerunRows[0]?.profitPerHour;
        await waitForMs(50);

        expect(simulator.advisor.runtime.phase).toBe("done");
        expect(simulator.advisor.error).toBe("");
        expect(simulator.advisor.quickRows[0]?.profitPerHour).toBe(topProfitAfterRerun);
        expect(topProfitAfterRerun).toBeGreaterThan(4000);
    });

    it("applyAdvisorTarget backfills Home target without touching unrelated settings", async () => {
        const { simulator } = createStoreWithMocks();
        simulator.simulationSettings.mooPass = true;
        simulator.simulationSettings.comExpEnabled = true;
        simulator.simulationSettings.comExp = 55;
        simulator.pricing.dropMode = "ask";
        const previousLabyrinthHrid = simulator.simulationSettings.labyrinthHrid;
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
        expect(appliedLabyrinth).toBe(false);
        expect(simulator.simulationSettings.mode).toBe("zone");
        expect(simulator.simulationSettings.labyrinthHrid).toBe(previousLabyrinthHrid);
        expect(simulator.simulationSettings.mooPass).toBe(true);
        expect(simulator.pricing.dropMode).toBe("ask");
    });
});
