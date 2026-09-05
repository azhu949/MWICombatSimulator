import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import actionDetailMap from '../../combatsimulator/data/actionDetailMap.json';

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

vi.mock('../../services/profitEstimator.js', () => ({
  estimateNoRngProfit: (simResult, playerHrid) => ({
    revenue: Number(simResult?.mockProfitByPlayer?.[playerHrid] ?? simResult?.mockProfit ?? 0),
    expenses: 0,
    profit: Number(simResult?.mockProfitByPlayer?.[playerHrid] ?? simResult?.mockProfit ?? 0),
  }),
  buildNoRngDropCountMap: (simResult) => new Map(Object.entries(simResult?.mockDropCountsByItem ?? {})),
}));

vi.mock('../../services/workerClient.js', () => {
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
    deferMultiCompletion: false,
    deferredMultiRuns: [],
    deferredMultiRunWaiters: [],
    activeSingleRuns: 0,
    maxConcurrentSingleRuns: 0,
    waitForDeferredMultiRun() {
      return new Promise((resolve) => {
        this.deferredMultiRunWaiters.push(resolve);
      });
    },
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
      this.deferMultiCompletion = false;
      this.deferredMultiRuns = [];
      this.deferredMultiRunWaiters = [];
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
    return 'unknown';
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
      ...(scopedMetric && typeof scopedMetric === 'object' ? scopedMetric : {}),
    };
  }

  function createSimResult(payload, metric) {
    const killsPerHour = Number(metric?.killsPerHour || 0);
    const players =
      Array.isArray(payload?.players) && payload.players.length > 0 ? payload.players : [{ hrid: 'player1' }];
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
      zoneName: String(payload?.zone?.zoneHrid || ''),
      labyrinthName: String(payload?.labyrinth?.labyrinthHrid || ''),
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
      mockDropCountsByItem: metric?.mockDropCountsByItem ?? {},
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
      const nextMetric =
        Array.isArray(queuedMetrics) && queuedMetrics.length > 0
          ? queuedMetrics.shift()
          : payload.zone
            ? workerState.zoneMetricResolver?.(payload.zone, workerState.singleCalls.length - 1, 'single') ||
              defaultMetricFromZone(payload.zone, workerState.singleCalls.length - 1)
            : workerState.labyrinthMetricResolver?.(payload.labyrinth, workerState.singleCalls.length - 1, 'single') ||
              defaultMetricFromLabyrinth(payload.labyrinth, workerState.singleCalls.length - 1);
      const emitSuccess = () =>
        finish(() => {
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
      const isZonePayload = payload.type === 'start_simulation_all_zones';
      const targets = isZonePayload ? payload.zones : payload.labyrinths;
      const batchResultType = isZonePayload ? 'simulation_result_allZones' : 'simulation_result_allLabyrinths';
      const simResults = targets.map((target, index) =>
        isZonePayload
          ? createSimResult(
              { zone: target, players: payload.players },
              workerState.zoneMetricResolver?.(target, index, 'multi') || defaultMetricFromZone(target, index),
            )
          : createSimResult(
              { labyrinth: target, players: payload.players },
              workerState.labyrinthMetricResolver?.(target, index, 'multi') ||
                defaultMetricFromLabyrinth(target, index),
            ),
      );
      const emitItemResult = (target, index) => {
        handlers.onProgress?.({ progress: (index + 1) / Math.max(1, targets.length) });
        handlers.onItemResult?.(
          isZonePayload
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
              },
        );
      };
      const emitBatchResult = () => {
        handlers.onProgress?.({ progress: 1 });
        handlers.onBatchResult?.(simResults, batchResultType);
      };

      if (workerState.deferMultiCompletion) {
        let completed = false;
        const deferredRun = {
          complete() {
            if (completed) {
              return;
            }
            completed = true;
            targets.slice(1).forEach((target, index) => emitItemResult(target, index + 1));
            emitBatchResult();
          },
        };
        workerState.deferredMultiRuns.push(deferredRun);
        workerState.deferredMultiRunWaiters.shift()?.(deferredRun);
        if (targets.length > 0) {
          emitItemResult(targets[0], 0);
        }
        return;
      }

      if (workerState.asyncMultiItemDelayMs > 0 || workerState.asyncMultiBatchDelayMs > 0) {
        targets.forEach((target, index) => {
          const delayMs = workerState.asyncMultiItemDelayMs * (index + 1);
          setTimeout(() => emitItemResult(target, index), delayMs);
        });
        const batchDelayMs = Math.max(
          workerState.asyncMultiBatchDelayMs,
          workerState.asyncMultiItemDelayMs * Math.max(1, targets.length),
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

import { useSimulatorStore } from '../simulatorStore.js';
import { mockWorkerState } from '../../services/workerClient.js';
import { buildAdvisorCandidates } from '../../services/advisorDomain.js';

describe('advisor store', () => {
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

  it('runs advisor across zone targets only and sorts the quick list', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: false,
    };
    simulator.advisor.goalPreset = 'profit';
    mockWorkerState.zoneMetricResolver = (zone, index) => ({
      profitPerHour: 120 + index,
      xpPerHour: 80 + index,
      killsPerHour: 12 + index,
      deathsPerHour: 0.3 + Number(zone?.difficultyTier || 0) * 0.2,
    });

    const rows = await simulator.runAdvisorScan();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.targetType === 'zone')).toBe(true);
    expect(rows.some((row) => row.targetType === 'labyrinth')).toBe(false);
    expect(simulator.advisor.filters).not.toHaveProperty('includeLabyrinths');
    expect(simulator.advisor.topCards.some((card) => card.key === 'labyrinth')).toBe(false);
    expect(mockWorkerState.multiCalls.map((payload) => payload.type)).toEqual(
      Array(simulator.advisor.filters.quickRounds).fill('start_simulation_all_zones'),
    );
  });

  it('uses the active player metrics instead of summing selected party members', async () => {
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
    expect(simulator.advisor.metricPlayerId).toBe('1');
    expect(simulator.advisor.metricPlayerName).toBe('Player 1');
  });

  it('ranks advisor targets by the active player metrics rather than party totals', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.players[1].selected = true;
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: false,
    };
    simulator.advisor.goalPreset = 'profit';
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
    const zonePayload = mockWorkerState.multiCalls.find((payload) => payload.type === 'start_simulation_all_zones');
    const expectedTopZone = zonePayload?.zones?.[1];

    expect(rows[0].profitPerHour).toBe(400);
    expect(rows[0].targetHrid).toBe(expectedTopZone?.zoneHrid);
    expect(rows[0].difficultyTier).toBe(expectedTopZone?.difficultyTier);
  });

  it('falls back to the first selected player when the active player is not selected', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.players[1].selected = false;
    simulator.players[2].selected = true;
    simulator.setActivePlayer('2');
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

    expect(simulator.resolvedAdvisorMetricPlayer.id).toBe('1');
    expect(simulator.resolvedAdvisorMetricPlayer.name).toBe('Player 1');
    expect(simulator.advisor.metricPlayerId).toBe('1');
    expect(simulator.advisor.metricPlayerName).toBe('Player 1');
    expect(rows[0].profitPerHour).toBe(123);
    expect(rows[0].xpPerHour).toBe(456);
    expect(rows[0].deathsPerHour).toBe(0.5);
  });

  it('refines only the configured top rows in parallel by round', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.queueRuntime.parallelWorkerLimit = 3;
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: true,
      refineTopCount: 8,
      refineRounds: 2,
    };
    simulator.advisor.goalPreset = 'balanced';
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

  it('streams quick scan rows before the batch run finishes', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: false,
      quickRounds: 1,
    };
    simulator.advisor.goalPreset = 'profit';
    mockWorkerState.deferMultiCompletion = true;
    mockWorkerState.zoneMetricResolver = (zone, index) => ({
      profitPerHour: 900 - index,
      xpPerHour: 400 + index,
      killsPerHour: 30 + index,
      deathsPerHour: 0.05 + Number(zone?.difficultyTier || 0) * 0.02,
    });

    const deferredRunPromise = mockWorkerState.waitForDeferredMultiRun();
    const runPromise = simulator.runAdvisorScan();
    const deferredRun = await deferredRunPromise;

    expect(deferredRun).toBeDefined();
    const zonePayload = mockWorkerState.multiCalls.find((payload) => payload.type === 'start_simulation_all_zones');
    expect(zonePayload?.zones?.length).toBeGreaterThan(3);
    expect(simulator.advisor.runtime.isRunning).toBe(true);
    expect(simulator.advisor.quickRows.length).toBeGreaterThan(0);
    expect(simulator.advisor.quickRows.length).toBeLessThan(zonePayload.zones.length);
    expect(simulator.advisor.topCards.length).toBeGreaterThan(0);

    deferredRun.complete();
    const rows = await runPromise;
    expect(rows).toHaveLength(zonePayload.zones.length);
  });

  it('keeps refining serial when parallel worker limit is 1', async () => {
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

  it('uses the actual quick survivors as the refine progress total', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.queueRuntime.parallelWorkerLimit = 1;
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      includeGroupZones: true,
      includeSoloZones: false,
      quickRounds: 1,
      refineTopEnabled: true,
      refineTopCount: 4,
      refineRounds: 2,
    };
    const candidates = buildAdvisorCandidates(simulator.advisor.filters);
    expect(candidates.length).toBeGreaterThan(4);
    const survivor = candidates[0];
    const survivorKey = `${survivor.targetHrid}#${survivor.difficultyTier}`;

    mockWorkerState.failMultiTypes.add('start_simulation_all_zones');
    for (const candidate of candidates) {
      const key = `${candidate.targetHrid}#${candidate.difficultyTier}`;
      if (key !== survivorKey) {
        mockWorkerState.failSingleKeys.add(key);
      }
    }

    await simulator.runAdvisorScan();

    expect(simulator.advisor.quickRows).toHaveLength(1);
    expect(simulator.advisor.runtime.quickTotal).toBe(candidates.length);
    expect(simulator.advisor.runtime.refineTotal).toBe(2);
    expect(mockWorkerState.singleCalls).toHaveLength(candidates.length + 2);
    expect(simulator.advisor.refinedRows.filter((row) => row.isRefined)).toHaveLength(1);
    expect(simulator.advisor.error).toContain('quick scan');
  });

  it('keeps other refine targets running when one target fails every round', async () => {
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
    expect(failedRow.successfulRounds).toBe(simulator.advisor.filters.quickRounds);
    expect(survivorRow.isRefined).toBe(true);
    expect(survivorRow.successfulRounds).toBe(2);
    expect(simulator.advisor.error).toContain('refine step');
  });

  it('stops advisor scans without clearing partial results', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: false,
      quickRounds: 1,
    };
    mockWorkerState.deferMultiCompletion = true;
    mockWorkerState.zoneMetricResolver = (zone, index) => ({
      profitPerHour: 700 - index,
      xpPerHour: 300 + index,
      killsPerHour: 18 + index,
      deathsPerHour: 0.1 + Number(zone?.difficultyTier || 0) * 0.02,
    });

    const deferredRunPromise = mockWorkerState.waitForDeferredMultiRun();
    const runPromise = simulator.runAdvisorScan();
    const deferredRun = await deferredRunPromise;

    expect(deferredRun).toBeDefined();
    const partialRowsBeforeStop = simulator.advisor.quickRows.length;
    expect(partialRowsBeforeStop).toBeGreaterThan(0);
    expect(simulator.stopAdvisorScan()).toBe(true);

    const rows = await runPromise;
    expect(rows).toHaveLength(partialRowsBeforeStop);
    expect(simulator.advisor.quickRows).toHaveLength(partialRowsBeforeStop);
    expect(simulator.advisor.runtime.isRunning).toBe(false);
    expect(simulator.advisor.runtime.phase).toBe('cancelled');
    expect(simulator.advisor.error).toBe('');

    deferredRun.complete();
    await Promise.resolve();
    expect(simulator.advisor.quickRows).toHaveLength(partialRowsBeforeStop);
  });

  it('surfaces streaming callback failures as advisor errors', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: false,
    };
    mockWorkerState.asyncMultiItemDelayMs = 2;
    mockWorkerState.asyncMultiBatchDelayMs = 20;

    simulator.rerankAdvisorResults = vi.fn(() => {
      throw new Error('forced rerank failure');
    });

    const rows = await simulator.runAdvisorScan();

    expect(rows).toEqual([]);
    expect(simulator.advisor.error).toBe('forced rerank failure');
    expect(simulator.advisor.runtime.isRunning).toBe(false);
    expect(simulator.advisor.runtime.phase).toBe('idle');
  });

  it('ignores late callbacks from a cancelled run after a new run starts', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: false,
      quickRounds: 1,
    };
    simulator.advisor.goalPreset = 'profit';
    mockWorkerState.deferMultiCompletion = true;
    mockWorkerState.zoneMetricResolver = (_zone, index) => ({
      profitPerHour: 100 + index,
      xpPerHour: 50 + index,
      killsPerHour: 10 + index,
      deathsPerHour: 0.2,
    });

    const cancelledDeferredRunPromise = mockWorkerState.waitForDeferredMultiRun();
    const cancelledRunPromise = simulator.runAdvisorScan();
    const cancelledDeferredRun = await cancelledDeferredRunPromise;
    expect(cancelledDeferredRun).toBeDefined();
    expect(simulator.advisor.quickRows.length).toBeGreaterThan(0);
    simulator.stopAdvisorScan();
    await cancelledRunPromise;

    mockWorkerState.deferMultiCompletion = false;
    mockWorkerState.zoneMetricResolver = (_zone, index) => ({
      profitPerHour: 5000 - index,
      xpPerHour: 1200 + index,
      killsPerHour: 60 + index,
      deathsPerHour: 0.01,
    });

    const rerunRows = await simulator.runAdvisorScan();
    const topProfitAfterRerun = rerunRows[0]?.profitPerHour;
    cancelledDeferredRun.complete();
    await Promise.resolve();

    expect(simulator.advisor.runtime.phase).toBe('done');
    expect(simulator.advisor.error).toBe('');
    expect(simulator.advisor.quickRows[0]?.profitPerHour).toBe(topProfitAfterRerun);
    expect(topProfitAfterRerun).toBeGreaterThan(4000);
  });

  it('ignores duplicate runAdvisorScan calls while the first scan is still starting', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: false,
      quickRounds: 1,
    };

    // 模拟双击：第二次调用发生在第一次扫描仍停留在 loadPlayerMapperModule 的
    // await 上（isRunning 尚未置位）的窗口内。
    const firstRunPromise = simulator.runAdvisorScan();
    const duplicateRows = await simulator.runAdvisorScan();

    // 重复请求静默返回 []，不报 ANOTHER_RUN 错误。
    expect(duplicateRows).toEqual([]);
    const rows = await firstRunPromise;
    expect(rows.length).toBeGreaterThan(0);

    // 窗口期重复请求被去重：quick 批量扫描只派发一次（旧实现会并发派发两次并
    // spawn 双 worker 池），runId 只递增一次，首次扫描完整跑完。
    expect(mockWorkerState.multiCalls.filter((payload) => payload.type === 'start_simulation_all_zones')).toHaveLength(
      1,
    );
    expect(simulator.advisor.runtime.runId).toBe(1);
    expect(simulator.advisor.runtime.scanInFlight).toBe(false);
    expect(simulator.advisor.runtime.isRunning).toBe(false);
    expect(simulator.advisor.runtime.phase).toBe('done');
    expect(simulator.advisor.error).toBe('');
  });

  it('applyAdvisorTarget backfills Home target without touching unrelated settings', async () => {
    const { simulator } = createStoreWithMocks();
    simulator.simulationSettings.mooPass = true;
    simulator.simulationSettings.comExpEnabled = true;
    simulator.simulationSettings.comExp = 55;
    simulator.pricing.dropMode = 'ask';
    const previousLabyrinthHrid = simulator.simulationSettings.labyrinthHrid;
    const validZone = Object.values(actionDetailMap).find(
      (entry) =>
        String(entry?.type || '') === '/action_types/combat' &&
        entry?.combatZoneInfo?.isDungeon !== true &&
        Number(entry?.maxDifficulty || 0) >= 3,
    );

    const appliedZone = simulator.applyAdvisorTarget({
      targetType: 'zone',
      targetHrid: validZone?.hrid || simulator.simulationSettings.zoneHrid,
      difficultyTier: 3,
    });
    expect(appliedZone).toBe(true);
    expect(simulator.simulationSettings.mode).toBe('zone');
    expect(simulator.simulationSettings.runScope).toBe('single');
    expect(simulator.simulationSettings.zoneHrid).toBe(validZone?.hrid || simulator.simulationSettings.zoneHrid);
    expect(simulator.simulationSettings.difficultyTier).toBe(3);
    expect(simulator.simulationSettings.mooPass).toBe(true);
    expect(simulator.pricing.dropMode).toBe('ask');

    const appliedLabyrinth = simulator.applyAdvisorTarget({
      targetType: 'labyrinth',
      targetHrid: '/combat_monsters/gobo_guardian',
      roomLevel: 140,
    });
    expect(appliedLabyrinth).toBe(false);
    expect(simulator.simulationSettings.mode).toBe('zone');
    expect(simulator.simulationSettings.labyrinthHrid).toBe(previousLabyrinthHrid);
    expect(simulator.simulationSettings.mooPass).toBe(true);
    expect(simulator.pricing.dropMode).toBe('ask');
  });

  it('blocks ironcow scans when no target drop item is selected', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.goalPreset = 'ironcow';
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      dropItemHrids: [],
      refineTopEnabled: false,
      quickRounds: 1,
    };
    // 已有上一轮（如 balanced 预设）扫描结果：一次被拒绝的扫描尝试不得清空它们。
    simulator.advisor.quickRows = [{ id: 'prev-quick' }];
    simulator.advisor.refinedRows = [];
    simulator.advisor.topCards = [{ key: 'overall' }];

    const scanPromise = simulator.runAdvisorScan();
    // 铁牛空物品校验只依赖同步 store 状态（goalPreset 与 filters），必须在首个
    // await（loadPlayerMapperModule 动态导入）之前同步报错——首扫不等导入窗口。
    expect(simulator.advisor.error).toBe('Please select at least one target drop item.');

    const rows = await scanPromise;

    expect(rows).toEqual([]);
    // 失败尝试保留旧结果（旧顺序在报错前已清空，旧结果被静默丢弃）。
    expect(simulator.advisor.quickRows).toEqual([{ id: 'prev-quick' }]);
    expect(simulator.advisor.refinedRows).toEqual([]);
    expect(simulator.advisor.topCards).toEqual([{ key: 'overall' }]);
    expect(simulator.advisor.scannedGoalPreset).toBe('');
    expect(simulator.advisor.scannedDropItemHrids).toEqual([]);
    expect(mockWorkerState.multiCalls).toHaveLength(0);
  });

  it('keeps previous results when the advisor has no targets for the current filters', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      includeSoloZones: false,
      includeGroupZones: false,
      refineTopEnabled: false,
    };
    // 无候选报错（NO_TARGETS）与铁牛空物品报错同族：也必须先于「清空结果」。
    simulator.advisor.quickRows = [{ id: 'prev-quick' }];
    simulator.advisor.topCards = [{ key: 'overall' }];

    const rows = await simulator.runAdvisorScan();

    expect(rows).toEqual([]);
    expect(simulator.advisor.error).toBe('No advisor targets available for the current filters.');
    expect(simulator.advisor.quickRows).toEqual([{ id: 'prev-quick' }]);
    expect(simulator.advisor.topCards).toEqual([{ key: 'overall' }]);
    expect(mockWorkerState.multiCalls).toHaveLength(0);
  });

  it('records scan metadata and per-item drop rates for ironcow scans', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.goalPreset = 'ironcow';
    simulator.updateAdvisorFilters({
      dropItemHrids: [' /items/marine_scale ', ''],
      refineTopEnabled: false,
      quickRounds: 1,
    });
    mockWorkerState.zoneMetricResolver = (_zone, index) => ({
      profitPerHour: 100 + index,
      xpPerHour: 50 + index,
      killsPerHour: 10,
      deathsPerHour: 0.1,
      mockDropCountsByItem: { '/items/marine_scale': 12 },
    });

    const rows = await simulator.runAdvisorScan();
    const expectedCandidates = buildAdvisorCandidates(simulator.advisor.filters, simulator.advisor.goalPreset);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(expectedCandidates.length);
    expect(simulator.advisor.error).toBe('');
    expect(simulator.advisor.scannedGoalPreset).toBe('ironcow');
    expect(simulator.advisor.scannedDropItemHrids).toEqual(['/items/marine_scale']);
    expect(simulator.advisor.dropDataStale).toBe(false);
    for (const row of rows) {
      expect(row.dropsPerHour).toBe(12);
      expect(row.dropRatesByItem).toEqual({ '/items/marine_scale': 12 });
    }
    expect(simulator.advisor.topCards.map((card) => card.key)).toEqual(['overall', 'profit', 'xp', 'drops']);
    expect(rows.some((row) => row.reasons.includes('top_drops'))).toBe(true);
    expect(rows.some((row) => row.reasons.includes('top_profit'))).toBe(false);

    const persisted = JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1'));
    expect(persisted.version).toBe(1);
    expect(persisted.goalPreset).toBe('ironcow');
    expect(persisted.filters.dropItemHrids).toEqual(['/items/marine_scale']);
  });

  it('ignores residual drop item selection for non-ironcow scans', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    // 铁牛模式选过物品后切回 balanced：物品列表随设置残留非空，
    // 但非铁牛模式不消费掉落数据，quick/refine 两条采样路径的扫描行都
    // 不应带 drops 值（也意味着残留物品不会触发每候选每轮的
    // buildNoRngDropCountMap 全掉落表遍历）。
    simulator.updateAdvisorFilters({
      dropItemHrids: ['/items/marine_scale'],
      refineTopEnabled: true,
      refineTopCount: 2,
      refineRounds: 1,
      quickRounds: 1,
    });
    mockWorkerState.zoneMetricResolver = (_zone, index) => ({
      profitPerHour: 100 + index,
      xpPerHour: 50 + index,
      killsPerHour: 10,
      deathsPerHour: 0.1,
      mockDropCountsByItem: { '/items/marine_scale': 12 },
    });

    const rows = await simulator.runAdvisorScan();

    expect(simulator.advisor.goalPreset).toBe('balanced');
    expect(simulator.advisor.dropDataStale).toBe(false);
    // 返回行 = 全候选合并集（top2 为精修行，覆盖 refine 路径门控），
    // quickRows 覆盖 quick 路径门控。
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.isRefined === true)).toHaveLength(2);
    for (const row of [...rows, ...simulator.advisor.quickRows]) {
      expect(row.dropsPerHour).toBe(0);
      expect(row.dropRatesByItem).toEqual({});
    }
    // 残留选择本身保留（持久化与切回铁牛后的可用性不受影响）。
    expect(simulator.advisor.filters.dropItemHrids).toEqual(['/items/marine_scale']);
    const persisted = JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1'));
    expect(persisted.filters.dropItemHrids).toEqual(['/items/marine_scale']);
  });

  it('persists settings on rerank by default and skips the storage write with persist:false', () => {
    const { simulator } = createStoreWithMocks();
    global.localStorage.setItem.mockClear();

    // 默认契约（用户交互路径）：rerank 即持久化。
    simulator.rerankAdvisorResults({ goalPreset: 'profit' });
    expect(simulator.advisor.goalPreset).toBe('profit');
    const defaultWrites = global.localStorage.setItem.mock.calls.filter(([key]) => key === 'mwi.advisor.settings.v1');
    expect(defaultWrites).toHaveLength(1);

    // persist:false（流式高频路径）：状态照常更新，但不落盘。
    global.localStorage.setItem.mockClear();
    simulator.rerankAdvisorResults({ goalPreset: 'ironcow', persist: false });
    expect(simulator.advisor.goalPreset).toBe('ironcow');
    const skippedWrites = global.localStorage.setItem.mock.calls.filter(([key]) => key === 'mwi.advisor.settings.v1');
    expect(skippedWrites).toHaveLength(0);
    // 磁盘快照不被跳过路径覆盖：仍停留在上次默认 rerank 的值。
    expect(JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1')).goalPreset).toBe('profit');

    // 用户路径再次 rerank 恢复逐次落盘。
    simulator.rerankAdvisorResults({ goalPreset: 'balanced' });
    expect(JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1')).goalPreset).toBe('balanced');
  });

  it('captures custom weight raw inputs on apply and keeps them through live reranks', () => {
    const { simulator } = createStoreWithMocks();

    // 页面应用路径：rerank 显式携带草稿快照 → 原始输入（用户口径）随归一化
    // 权重（引擎口径）一并入 store 并落盘（G3 2026-09-05：刷新后输入框回显源）。
    simulator.rerankAdvisorResults({
      goalPreset: 'custom',
      customWeights: { profitPerHour: 0.6, xpPerHour: 0.42, safety: 0.1 },
      customWeightInputs: { profitPerHour: 0.6, xpPerHour: 0.42, safety: 0.1 },
    });
    expect(simulator.advisor.customWeights.profitPerHour).toBeCloseTo(0.5294, 3);
    expect(simulator.advisor.customWeightInputs).toEqual({ profitPerHour: 0.6, xpPerHour: 0.42 });
    const persisted = JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1'));
    expect(persisted.customWeightInputs).toEqual({ profitPerHour: 0.6, xpPerHour: 0.42 });

    // 流式 live rerank（扫描期间，persist:false）：只传归一化权重、不传原始输入
    // → 原始输入不被归一化中间值覆盖（advisorRunExecution 的 rerankLive* 契约）。
    simulator.rerankAdvisorResults({
      goalPreset: 'custom',
      customWeights: { ...simulator.advisor.customWeights },
      persist: false,
    });
    expect(simulator.advisor.customWeightInputs).toEqual({ profitPerHour: 0.6, xpPerHour: 0.42 });
  });

  it('does not amplify advisor settings writes during a streaming scan', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    // 直接赋值 filters（不经 updateAdvisorFilters），排除额外落盘干扰。
    simulator.advisor.filters = {
      ...simulator.advisor.filters,
      refineTopEnabled: false,
    };
    mockWorkerState.zoneMetricResolver = (_zone, index) => ({
      profitPerHour: 100 + index,
      xpPerHour: 50 + index,
      killsPerHour: 10,
      deathsPerHour: 0.1,
    });
    global.localStorage.setItem.mockClear();

    const rows = await simulator.runAdvisorScan();
    const quickRounds = simulator.advisor.filters.quickRounds;

    // 扫描确有足量流式 rerank（每个候选每轮 quick 结果触发一次），
    // 修复前 advisor 键写入次数 ≈ 候选数 × quick 轮数 + 收尾 + 扫描开始。
    expect(rows.length).toBeGreaterThan(0);
    expect(mockWorkerState.multiCalls).toHaveLength(quickRounds);
    expect(rows.length * quickRounds).toBeGreaterThan(1);

    // 修复后：advisor 设置键仅扫描开始 + 扫描完成收尾各落盘 1 次（共 2 次）。
    const advisorKeyWrites = global.localStorage.setItem.mock.calls.filter(
      ([key]) => key === 'mwi.advisor.settings.v1',
    );
    expect(advisorKeyWrites).toHaveLength(2);
    // 落盘内容与当前设置一致（收尾写覆盖的设置快照）。
    const persisted = JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1'));
    expect(persisted.goalPreset).toBe(simulator.advisor.goalPreset);
    expect(persisted.filters.quickRounds).toBe(quickRounds);
  });

  it('marks ironcow drop data stale when items change after a scan', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.goalPreset = 'ironcow';
    simulator.updateAdvisorFilters({
      dropItemHrids: ['/items/marine_scale'],
      refineTopEnabled: false,
      quickRounds: 1,
    });
    mockWorkerState.zoneMetricResolver = () => ({
      profitPerHour: 100,
      xpPerHour: 50,
      killsPerHour: 10,
      deathsPerHour: 0.1,
      mockDropCountsByItem: { '/items/marine_scale': 12 },
    });
    await simulator.runAdvisorScan();
    expect(simulator.advisor.dropDataStale).toBe(false);

    // 改物品 → 陈旧（updateAdvisorFilters 即时置位，rerank 保持）
    simulator.updateAdvisorFilters({ dropItemHrids: ['/items/marine_scale', '/items/pearl'] });
    expect(simulator.advisor.dropDataStale).toBe(true);
    simulator.rerankAdvisorResults();
    expect(simulator.advisor.dropDataStale).toBe(true);

    // 改回原物品集合 → 复位
    simulator.updateAdvisorFilters({ dropItemHrids: ['/items/marine_scale'] });
    expect(simulator.advisor.dropDataStale).toBe(false);

    // 切到非铁牛预设：掉落数据不参与评分 → 不标记陈旧
    simulator.rerankAdvisorResults({ goalPreset: 'balanced' });
    expect(simulator.advisor.dropDataStale).toBe(false);

    // 切回铁牛且物品未变 → 仍不陈旧
    simulator.rerankAdvisorResults({ goalPreset: 'ironcow' });
    expect(simulator.advisor.dropDataStale).toBe(false);
  });

  it('clears scan results via clearAdvisorResults without touching persisted settings', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.advisor.goalPreset = 'ironcow';
    simulator.updateAdvisorFilters({
      dropItemHrids: ['/items/marine_scale'],
      refineTopEnabled: false,
      quickRounds: 1,
    });
    mockWorkerState.zoneMetricResolver = () => ({
      profitPerHour: 100,
      xpPerHour: 50,
      killsPerHour: 10,
      deathsPerHour: 0.1,
      mockDropCountsByItem: { '/items/marine_scale': 12 },
    });
    await simulator.runAdvisorScan();
    expect(simulator.advisor.quickRows.length).toBeGreaterThan(0);

    expect(simulator.clearAdvisorResults()).toBe(true);
    // 会话内结果状态全部清空。
    expect(simulator.advisor.quickRows).toEqual([]);
    expect(simulator.advisor.refinedRows).toEqual([]);
    expect(simulator.advisor.topCards).toEqual([]);
    expect(simulator.advisor.scannedGoalPreset).toBe('');
    expect(simulator.advisor.scannedDropItemHrids).toEqual([]);
    expect(simulator.advisor.dropDataStale).toBe(false);
    // 已持久化的设置不受影响。
    expect(simulator.advisor.goalPreset).toBe('ironcow');
    expect(simulator.advisor.filters.dropItemHrids).toEqual(['/items/marine_scale']);
  });

  it('marks ironcow results stale until a scan runs in ironcow mode', async () => {
    const { simulator, mockWorkerState } = createStoreWithMocks();
    simulator.updateAdvisorFilters({
      dropItemHrids: ['/items/marine_scale'],
      refineTopEnabled: false,
      quickRounds: 1,
    });
    mockWorkerState.zoneMetricResolver = () => ({
      profitPerHour: 100,
      xpPerHour: 50,
      killsPerHour: 10,
      deathsPerHour: 0.1,
      mockDropCountsByItem: { '/items/marine_scale': 3 },
    });

    // 默认 balanced 扫描：scannedGoalPreset 记为 balanced
    await simulator.runAdvisorScan();
    expect(simulator.advisor.scannedGoalPreset).toBe('balanced');

    // 切到铁牛（未重新扫描）→ 掉落数据陈旧
    simulator.rerankAdvisorResults({ goalPreset: 'ironcow' });
    expect(simulator.advisor.dropDataStale).toBe(true);

    // 铁牛下重新扫描 → 复位
    simulator.advisor.goalPreset = 'ironcow';
    await simulator.runAdvisorScan();
    expect(simulator.advisor.scannedGoalPreset).toBe('ironcow');
    expect(simulator.advisor.scannedDropItemHrids).toEqual(['/items/marine_scale']);
    expect(simulator.advisor.dropDataStale).toBe(false);
  });

  it('normalizes and persists advisor filter patches without resetting siblings', () => {
    const { simulator } = createStoreWithMocks();
    simulator.updateAdvisorFilters({ quickRounds: 2, includeSoloZones: true });
    simulator.updateAdvisorFilters({
      dropItemHrids: ['  /items/marine_scale  ', '', '/items/marine_scale', '   '],
    });

    expect(simulator.advisor.filters.dropItemHrids).toEqual(['/items/marine_scale']);
    expect(simulator.advisor.filters.quickRounds).toBe(2);
    expect(simulator.advisor.filters.includeSoloZones).toBe(true);
    expect(simulator.advisor.filters.includeGroupZones).toBe(true);

    const persisted = JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1'));
    expect(persisted.version).toBe(1);
    expect(persisted.goalPreset).toBe('balanced');
    expect(persisted.filters.dropItemHrids).toEqual(['/items/marine_scale']);
    expect(persisted.filters.quickRounds).toBe(2);
    expect(persisted.ironcowWeights).toEqual({ dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 });
  });

  it('rejects advisor filter updates while a scan is running or starting', () => {
    const { simulator } = createStoreWithMocks();
    simulator.updateAdvisorFilters({ quickRounds: 2 });
    const lockedFilters = simulator.advisor.filters;
    global.localStorage.setItem.mockClear();

    // isRunning 期间（程序化调用绕过页面层 UI 禁用的 store 兜底）：拒绝写入、
    // 不落盘，原样返回当前 filters（返回值契约与正常路径一致）。
    simulator.advisor.runtime.isRunning = true;
    const rejectedWhileRunning = simulator.updateAdvisorFilters({
      quickRounds: 9,
      dropItemHrids: ['/items/pearl'],
    });
    expect(rejectedWhileRunning).toBe(lockedFilters);
    expect(simulator.advisor.filters).toBe(lockedFilters);
    expect(simulator.advisor.filters.quickRounds).toBe(2);
    expect(simulator.advisor.filters.dropItemHrids).toEqual([]);
    const writesWhileRunning = global.localStorage.setItem.mock.calls.filter(
      ([key]) => key === 'mwi.advisor.settings.v1',
    );
    expect(writesWhileRunning).toHaveLength(0);

    // scanInFlight 窗口期（loadPlayerMapperModule 导入中，isRunning 尚未置位，
    // 即双击「开始推荐」时 runAdvisor #2 的 filterDraft 提交路径）：同样拒绝，
    // 避免 filterDraft 覆盖 store filters 与扫描中途的冗余落盘。
    simulator.advisor.runtime.isRunning = false;
    simulator.advisor.runtime.scanInFlight = true;
    const rejectedWhileStarting = simulator.updateAdvisorFilters({ quickRounds: 9 });
    expect(rejectedWhileStarting).toBe(lockedFilters);
    expect(simulator.advisor.filters.quickRounds).toBe(2);
    const writesWhileStarting = global.localStorage.setItem.mock.calls.filter(
      ([key]) => key === 'mwi.advisor.settings.v1',
    );
    expect(writesWhileStarting).toHaveLength(0);

    // 扫描结束（两标志复位）后恢复正常写入与持久化。
    simulator.advisor.runtime.scanInFlight = false;
    simulator.updateAdvisorFilters({ quickRounds: 5 });
    expect(simulator.advisor.filters.quickRounds).toBe(5);
    expect(JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1')).filters.quickRounds).toBe(5);
  });

  it('restores persisted advisor settings on store init without reviving result rows', () => {
    global.localStorage.setItem(
      'mwi.advisor.settings.v1',
      JSON.stringify({
        version: 1,
        savedAt: 123,
        goalPreset: 'ironcow',
        customWeights: { profitPerHour: 0.7, xpPerHour: 0.2, safety: 0.1 },
        ironcowWeights: { dropsPerHour: 0.2, xpPerHour: 0.7, safety: 0.1 },
        filters: {
          includeSoloZones: true,
          quickRounds: 2,
          dropItemHrids: ['  /items/marine_scale  ', '/items/marine_scale', ''],
        },
      }),
    );

    const { simulator } = createStoreWithMocks();

    expect(simulator.advisor.goalPreset).toBe('ironcow');
    expect(simulator.advisor.ironcowWeights).toEqual({ dropsPerHour: 0.2, xpPerHour: 0.7, safety: 0.1 });
    expect(simulator.advisor.customWeights.profitPerHour).toBeCloseTo(0.7, 10);
    expect(simulator.advisor.customWeights.xpPerHour).toBeCloseTo(0.2, 10);
    expect(simulator.advisor.customWeights.safety).toBeCloseTo(0.1, 10);
    expect(simulator.advisor.filters.includeSoloZones).toBe(true);
    expect(simulator.advisor.filters.quickRounds).toBe(2);
    expect(simulator.advisor.filters.dropItemHrids).toEqual(['/items/marine_scale']);
    expect(simulator.advisor.quickRows).toEqual([]);
    expect(simulator.advisor.refinedRows).toEqual([]);
    expect(simulator.advisor.topCards).toEqual([]);
    expect(simulator.advisor.scannedGoalPreset).toBe('');
    expect(simulator.advisor.dropDataStale).toBe(false);
  });

  it('increments the advisor run request token without persisting it', () => {
    const { simulator } = createStoreWithMocks();
    expect(simulator.advisor.runRequestToken).toBe(0);

    // 顶栏每次「开始推荐」递增 token，AdvisorPage watch 据此触发本地 runAdvisor()。
    expect(simulator.requestAdvisorRun()).toBe(1);
    expect(simulator.advisor.runRequestToken).toBe(1);
    expect(typeof simulator.advisor.runRequestToken).toBe('number');
    expect(simulator.requestAdvisorRun()).toBe(2);
    expect(simulator.advisor.runRequestToken).toBe(2);

    // token 是会话内计数器：持久化负载只含 goalPreset/权重/filters，不含 token。
    simulator.updateAdvisorFilters({ quickRounds: 3 });
    const persisted = JSON.parse(global.localStorage.getItem('mwi.advisor.settings.v1'));
    expect(persisted.version).toBe(1);
    expect(persisted).not.toHaveProperty('runRequestToken');
    expect(JSON.stringify(persisted)).not.toContain('runRequestToken');

    // resetAdvisorState 重建会话内状态后 token 归零。
    simulator.resetAdvisorState();
    expect(simulator.advisor.runRequestToken).toBe(0);
    expect(typeof simulator.advisor.runRequestToken).toBe('number');
  });
});
